import { Router, type IRouter } from "express";
import { and, eq, isNull, isNotNull, desc } from "drizzle-orm";
import { db, clientsTable, filesTable, loansTable } from "@workspace/db";
import { RestoreTrashItemParams, PurgeTrashItemParams } from "@workspace/api-zod";
import { loadAzureSettings } from "../lib/azure-settings";
import { deleteDocumentRefSafe } from "../lib/document-store";

const router: IRouter = Router();

/** Best-effort removal of a loan's source-document blob if no other loan
 * still references it. */
async function cleanupLoanBlob(blobRef: string | null): Promise<void> {
  if (!blobRef) return;
  const others = await db
    .select({ id: loansTable.id })
    .from(loansTable)
    .where(eq(loansTable.sourceDocumentBlob, blobRef))
    .limit(1);
  if (others.length === 0) {
    const settings = await loadAzureSettings();
    await deleteDocumentRefSafe(settings, blobRef);
  }
}

router.get("/trash", async (_req, res): Promise<void> => {
  const clients = await db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      deletedAt: clientsTable.deletedAt,
    })
    .from(clientsTable)
    .where(isNotNull(clientsTable.deletedAt))
    .orderBy(desc(clientsTable.deletedAt));

  // Only show files whose client is NOT itself trashed (those are restored
  // implicitly with the client); same idea for loans below.
  const files = await db
    .select({
      id: filesTable.id,
      name: filesTable.name,
      fiscalYearEnd: filesTable.fiscalYearEnd,
      clientName: clientsTable.name,
      deletedAt: filesTable.deletedAt,
    })
    .from(filesTable)
    .innerJoin(clientsTable, eq(clientsTable.id, filesTable.clientId))
    .where(and(isNotNull(filesTable.deletedAt), isNull(clientsTable.deletedAt)))
    .orderBy(desc(filesTable.deletedAt));

  const loans = await db
    .select({
      id: loansTable.id,
      name: loansTable.name,
      isCapitalLease: loansTable.isCapitalLease,
      monthlyPayment: loansTable.monthlyPayment,
      fileName: filesTable.name,
      fiscalYearEnd: filesTable.fiscalYearEnd,
      clientName: clientsTable.name,
      deletedAt: loansTable.deletedAt,
    })
    .from(loansTable)
    .innerJoin(filesTable, eq(filesTable.id, loansTable.fileId))
    .innerJoin(clientsTable, eq(clientsTable.id, filesTable.clientId))
    .where(
      and(
        isNotNull(loansTable.deletedAt),
        isNull(filesTable.deletedAt),
        isNull(clientsTable.deletedAt)
      )
    )
    .orderBy(desc(loansTable.deletedAt));

  const stripTime = (d: string | null): string | null => (d ? d.split("T")[0] : null);

  res.json({
    clients: clients.map((c) => ({
      ...c,
      deletedAt: c.deletedAt?.toISOString() ?? null,
    })),
    files: files.map((f) => ({
      ...f,
      fiscalYearEnd: stripTime(f.fiscalYearEnd),
      deletedAt: f.deletedAt?.toISOString() ?? null,
    })),
    loans: loans.map((l) => ({
      id: l.id,
      name: l.name,
      isCapitalLease: l.isCapitalLease,
      fileName: l.fileName,
      fiscalYearEnd: stripTime(l.fiscalYearEnd),
      clientName: l.clientName,
      deletedAt: l.deletedAt?.toISOString() ?? null,
    })),
  });
});

router.post("/trash/:type/:id/restore", async (req, res): Promise<void> => {
  const params = RestoreTrashItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { type, id } = params.data;

  if (type === "client") {
    const [row] = await db
      .update(clientsTable)
      .set({ deletedAt: null })
      .where(and(eq(clientsTable.id, id), isNotNull(clientsTable.deletedAt)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Trashed client not found" });
      return;
    }
  } else if (type === "file") {
    const [row] = await db
      .update(filesTable)
      .set({ deletedAt: null })
      .where(and(eq(filesTable.id, id), isNotNull(filesTable.deletedAt)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Trashed year-end file not found" });
      return;
    }
    // Make sure the restored file is reachable: un-trash its client too.
    await db
      .update(clientsTable)
      .set({ deletedAt: null })
      .where(and(eq(clientsTable.id, row.clientId), isNotNull(clientsTable.deletedAt)));
  } else {
    const [row] = await db
      .update(loansTable)
      .set({ deletedAt: null })
      .where(and(eq(loansTable.id, id), isNotNull(loansTable.deletedAt)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Trashed loan not found" });
      return;
    }
    // Make sure the restored loan is reachable: un-trash its file and client.
    await db
      .update(filesTable)
      .set({ deletedAt: null })
      .where(and(eq(filesTable.id, row.fileId), isNotNull(filesTable.deletedAt)));
    const [parentFile] = await db
      .select({ clientId: filesTable.clientId })
      .from(filesTable)
      .where(eq(filesTable.id, row.fileId));
    if (parentFile) {
      await db
        .update(clientsTable)
        .set({ deletedAt: null })
        .where(and(eq(clientsTable.id, parentFile.clientId), isNotNull(clientsTable.deletedAt)));
    }
  }

  res.sendStatus(204);
});

router.delete("/trash/:type/:id", async (req, res): Promise<void> => {
  const params = PurgeTrashItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { type, id } = params.data;

  if (type === "client") {
    // Collect source-document blobs of all loans under this client before the
    // cascade wipes them.
    const loanBlobs = await db
      .select({ blob: loansTable.sourceDocumentBlob })
      .from(loansTable)
      .innerJoin(filesTable, eq(filesTable.id, loansTable.fileId))
      .where(and(eq(filesTable.clientId, id), isNotNull(loansTable.sourceDocumentBlob)));
    const [row] = await db
      .delete(clientsTable)
      .where(and(eq(clientsTable.id, id), isNotNull(clientsTable.deletedAt)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Trashed client not found" });
      return;
    }
    for (const { blob } of loanBlobs) {
      try {
        await cleanupLoanBlob(blob);
      } catch (err) {
        req.log?.warn({ err }, "Failed to delete source document blob");
      }
    }
  } else if (type === "file") {
    const loanBlobs = await db
      .select({ blob: loansTable.sourceDocumentBlob })
      .from(loansTable)
      .where(and(eq(loansTable.fileId, id), isNotNull(loansTable.sourceDocumentBlob)));
    const [row] = await db
      .delete(filesTable)
      .where(and(eq(filesTable.id, id), isNotNull(filesTable.deletedAt)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Trashed year-end file not found" });
      return;
    }
    for (const { blob } of loanBlobs) {
      try {
        await cleanupLoanBlob(blob);
      } catch (err) {
        req.log?.warn({ err }, "Failed to delete source document blob");
      }
    }
  } else {
    const [row] = await db
      .delete(loansTable)
      .where(and(eq(loansTable.id, id), isNotNull(loansTable.deletedAt)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Trashed loan not found" });
      return;
    }
    try {
      await cleanupLoanBlob(row.sourceDocumentBlob);
    } catch (err) {
      req.log?.warn({ err }, "Failed to delete source document blob");
    }
  }

  res.sendStatus(204);
});

export default router;
