import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, masterAgreementsTable, loansTable } from "@workspace/db";
import {
  GetFileParams,
  CreateMasterAgreementBody,
  GetMasterAgreementParams,
  UpdateMasterAgreementParams,
  UpdateMasterAgreementBody,
  DeleteMasterAgreementParams,
} from "@workspace/api-zod";
import { loadAzureSettings, requireSettings, UserFacingError } from "../lib/azure-settings";
import { retrieveDocument } from "../lib/document-store";

const router: IRouter = Router();

// Normalize a DB row into the API response shape: nullable columns become
// `undefined` so they are omitted from JSON, matching the OpenAPI contract.
const cleanMaster = (m: typeof masterAgreementsTable.$inferSelect) => ({
  id: m.id,
  fileId: m.fileId,
  lender: m.lender,
  description: m.description ?? undefined,
  facilityLimit: m.facilityLimit ?? undefined,
  securityClauses: m.securityClauses ?? undefined,
  securityDescription: m.securityDescription ?? undefined,
  covenantDescription: m.covenantDescription ?? undefined,
  sourceDocumentName: m.sourceDocumentName ?? undefined,
  rolledFromId: m.rolledFromId ?? undefined,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
});

router.get("/files/:id/master-agreements", async (req, res): Promise<void> => {
  const params = GetFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const masters = await db
    .select()
    .from(masterAgreementsTable)
    .where(and(eq(masterAgreementsTable.fileId, params.data.id), isNull(masterAgreementsTable.deletedAt)))
    .orderBy(masterAgreementsTable.createdAt);

  res.json(masters.map(cleanMaster));
});

router.post("/files/:id/master-agreements", async (req, res): Promise<void> => {
  const params = GetFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateMasterAgreementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;

  if (!data.lender.trim()) {
    res.status(400).json({ error: "Lender is required" });
    return;
  }
  if (data.facilityLimit != null && !(data.facilityLimit > 0)) {
    res.status(400).json({ error: "facilityLimit must be greater than zero" });
    return;
  }

  const [master] = await db
    .insert(masterAgreementsTable)
    .values({
      fileId: params.data.id,
      lender: data.lender.trim(),
      description: data.description ?? null,
      facilityLimit: data.facilityLimit != null ? data.facilityLimit.toString() : null,
      securityClauses: data.securityClauses ?? null,
      securityDescription: data.securityDescription ?? null,
      covenantDescription: data.covenantDescription ?? null,
      sourceDocumentBlob: data.sourceDocumentBlob ?? null,
      sourceDocumentName: data.sourceDocumentName ?? null,
    })
    .returning();

  res.status(201).json(cleanMaster(master));
});

router.get("/master-agreements/:id", async (req, res): Promise<void> => {
  const params = GetMasterAgreementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [master] = await db
    .select()
    .from(masterAgreementsTable)
    .where(and(eq(masterAgreementsTable.id, params.data.id), isNull(masterAgreementsTable.deletedAt)));

  if (!master) {
    res.status(404).json({ error: "Master agreement not found" });
    return;
  }

  res.json(cleanMaster(master));
});

router.patch("/master-agreements/:id", async (req, res): Promise<void> => {
  const params = UpdateMasterAgreementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateMasterAgreementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;

  const updates: Record<string, unknown> = {};
  if (data.lender != null) {
    if (!data.lender.trim()) {
      res.status(400).json({ error: "Lender cannot be empty" });
      return;
    }
    updates.lender = data.lender.trim();
  }
  // Explicit nulls clear nullable columns (send null to remove a value).
  if (data.description !== undefined) updates.description = data.description;
  if (data.facilityLimit !== undefined) {
    if (data.facilityLimit != null && !(data.facilityLimit > 0)) {
      res.status(400).json({ error: "facilityLimit must be greater than zero" });
      return;
    }
    updates.facilityLimit = data.facilityLimit != null ? data.facilityLimit.toString() : null;
  }
  if (data.securityClauses !== undefined) updates.securityClauses = data.securityClauses;
  if (data.securityDescription !== undefined) updates.securityDescription = data.securityDescription;
  if (data.covenantDescription !== undefined) updates.covenantDescription = data.covenantDescription;

  const [master] = await db
    .update(masterAgreementsTable)
    .set(updates)
    .where(and(eq(masterAgreementsTable.id, params.data.id), isNull(masterAgreementsTable.deletedAt)))
    .returning();

  if (!master) {
    res.status(404).json({ error: "Master agreement not found" });
    return;
  }

  res.json(cleanMaster(master));
});

router.delete("/master-agreements/:id", async (req, res): Promise<void> => {
  const params = DeleteMasterAgreementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Soft delete the master and unlink its facilities atomically so loans
  // never point at a hidden master. The loans themselves are untouched —
  // they simply become standalone again.
  const master = await db.transaction(async (tx) => {
    const [m] = await tx
      .update(masterAgreementsTable)
      .set({ deletedAt: new Date() })
      .where(and(eq(masterAgreementsTable.id, params.data.id), isNull(masterAgreementsTable.deletedAt)))
      .returning();
    if (!m) return null;
    await tx
      .update(loansTable)
      .set({ masterAgreementId: null })
      .where(eq(loansTable.masterAgreementId, m.id));
    return m;
  });

  if (!master) {
    res.status(404).json({ error: "Master agreement not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/master-agreements/:id/source-document", async (req, res): Promise<void> => {
  const params = GetMasterAgreementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [master] = await db
    .select()
    .from(masterAgreementsTable)
    .where(and(eq(masterAgreementsTable.id, params.data.id), isNull(masterAgreementsTable.deletedAt)));

  if (!master || !master.sourceDocumentBlob) {
    res.status(404).json({ error: "No source document for this master agreement" });
    return;
  }

  try {
    const settings = await loadAzureSettings();
    if (!master.sourceDocumentBlob.startsWith("db:")) {
      requireSettings(settings, ["storageConnectionString"], "Downloading the source document");
    }
    const buffer = await retrieveDocument(settings, master.sourceDocumentBlob);
    if (!buffer) {
      res.status(404).json({ error: "The stored document could not be found" });
      return;
    }
    const name = master.sourceDocumentName ?? "document.pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${name.replace(/"/g, "")}"`);
    res.send(buffer);
  } catch (err) {
    if (err instanceof UserFacingError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
