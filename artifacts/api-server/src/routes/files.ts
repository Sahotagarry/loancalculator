import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, filesTable, loansTable } from "@workspace/db";
import { evaluateFvDecisionsForFile } from "../lib/fv-decisions";
import {
  CreateFileBody,
  GetFileParams,
  GetFileResponse,
  DeleteFileParams,
  ListFilesResponse,
  GetClientParams,
  UpdateFileBody,
  UpdateFileParams,
  RollForwardFileParams,
  RollForwardFileBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/clients/:id/files", async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const files = await db
    .select()
    .from(filesTable)
    .where(and(eq(filesTable.clientId, params.data.id), isNull(filesTable.deletedAt)))
    .orderBy(filesTable.fiscalYearEnd);

  const stripTime = (d: string | null): string | undefined =>
    d ? d.split("T")[0] : undefined;
  const cleanNum = (v: string | null): number | undefined => v != null ? Number(v) : undefined;

  const cleanFiles = files.map((f) => ({
    ...f,
    fiscalYearEnd: stripTime(f.fiscalYearEnd) ?? f.fiscalYearEnd,
    trivialThreshold: cleanNum(f.trivialThreshold),
    materiality: cleanNum(f.materiality),
  }));

  res.json(cleanFiles);
});

router.post("/clients/:id/files", async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateFileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [file] = await db
    .insert(filesTable)
    .values({
      name: parsed.data.name,
      fiscalYearEnd: parsed.data.fiscalYearEnd.toISOString().split("T")[0],
      clientId: params.data.id,
      trivialThreshold: parsed.data.trivialThreshold != null ? parsed.data.trivialThreshold.toString() : undefined,
      materiality: parsed.data.materiality != null ? parsed.data.materiality.toString() : undefined,
    })
    .returning();

  const stripTime = (d: string | null): string | undefined =>
    d ? d.split("T")[0] : undefined;
  const cleanNum = (v: string | null): number | undefined => v != null ? Number(v) : undefined;

  res.status(201).json({
    ...file,
    fiscalYearEnd: stripTime(file.fiscalYearEnd) ?? file.fiscalYearEnd,
    trivialThreshold: cleanNum(file.trivialThreshold),
    materiality: cleanNum(file.materiality),
  });
});

router.get("/files/:id", async (req, res): Promise<void> => {
  const params = GetFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [file] = await db
    .select()
    .from(filesTable)
    .where(and(eq(filesTable.id, params.data.id), isNull(filesTable.deletedAt)));

  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const stripTime = (d: string | null): string | undefined =>
    d ? d.split("T")[0] : undefined;

  const cleanNum = (v: string | null): number | undefined => v != null ? Number(v) : undefined;

  res.json({
    ...file,
    fiscalYearEnd: stripTime(file.fiscalYearEnd) ?? file.fiscalYearEnd,
    trivialThreshold: cleanNum(file.trivialThreshold),
    materiality: cleanNum(file.materiality),
  });
});

router.patch("/files/:id", async (req, res): Promise<void> => {
  const params = UpdateFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateFileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.fiscalYearEnd !== undefined) {
    updates.fiscalYearEnd = parsed.data.fiscalYearEnd.toISOString().split("T")[0];
  }
  if (parsed.data.trivialThreshold !== undefined) updates.trivialThreshold = parsed.data.trivialThreshold?.toString();
  if (parsed.data.materiality !== undefined) updates.materiality = parsed.data.materiality?.toString();
  if (parsed.data.dismissedFindings !== undefined) updates.dismissedFindings = parsed.data.dismissedFindings;

  const [file] = await db
    .update(filesTable)
    .set(updates)
    .where(and(eq(filesTable.id, params.data.id), isNull(filesTable.deletedAt)))
    .returning();

  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  // The loans in this file carry a denormalized copy of the fiscal year end —
  // keep them in sync so schedules, disclosures, and classifications follow.
  if (parsed.data.fiscalYearEnd !== undefined) {
    await db
      .update(loansTable)
      .set({ fiscalYearEnd: file.fiscalYearEnd })
      .where(eq(loansTable.fileId, file.id));
  }

  if (parsed.data.trivialThreshold !== undefined || parsed.data.materiality !== undefined) {
    await evaluateFvDecisionsForFile(file.id, {
      trivialThreshold: file.trivialThreshold,
      materiality: file.materiality,
    });
  }

  const stripTime = (d: string | null): string | undefined =>
    d ? d.split("T")[0] : undefined;
  const cleanNum = (v: string | null): number | undefined => v != null ? Number(v) : undefined;

  res.json({
    ...file,
    fiscalYearEnd: stripTime(file.fiscalYearEnd) ?? file.fiscalYearEnd,
    trivialThreshold: cleanNum(file.trivialThreshold),
    materiality: cleanNum(file.materiality),
  });
});

router.delete("/files/:id", async (req, res): Promise<void> => {
  const params = DeleteFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Soft delete: move to trash (recoverable). Permanent deletion happens via
  // the trash endpoints.
  const [file] = await db
    .update(filesTable)
    .set({ deletedAt: new Date() })
    .where(and(eq(filesTable.id, params.data.id), isNull(filesTable.deletedAt)))
    .returning();

  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/files/:id/rollforward", async (req, res): Promise<void> => {
  const params = RollForwardFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = RollForwardFileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Get the source file
  const [originalFile] = await db
    .select()
    .from(filesTable)
    .where(and(eq(filesTable.id, params.data.id), isNull(filesTable.deletedAt)));

  if (!originalFile) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const newFiscalYearEnd = parsed.data.newFiscalYearEnd.toISOString().split("T")[0];

  // Get all loans from the original file (excluding trashed ones)
  const originalLoans = await db
    .select()
    .from(loansTable)
    .where(and(eq(loansTable.fileId, params.data.id), isNull(loansTable.deletedAt)));

  // Only roll forward loans/leases still outstanding at the source file's
  // fiscal year end: maturity (start + termMonths, or termYears if months not
  // set) must fall strictly after the source FYE. Matured loans and expired
  // leases stay behind in the old file.
  const sourceFye = originalFile.fiscalYearEnd
    ? new Date(originalFile.fiscalYearEnd.split("T")[0] + "T00:00:00Z")
    : null;
  const outstandingLoans = originalLoans.filter((loan) => {
    if (!sourceFye || !loan.startDate) return true;
    const start = new Date(loan.startDate.split("T")[0] + "T00:00:00Z");
    if (isNaN(start.getTime())) return true;
    const months =
      loan.termMonths != null ? loan.termMonths : (loan.termYears ?? 0) * 12;
    if (months <= 0) return true;
    const maturity = new Date(start);
    maturity.setUTCMonth(maturity.getUTCMonth() + months);
    return maturity.getTime() > sourceFye.getTime();
  });

  // Create the new file and copy the outstanding loans atomically so a
  // mid-copy failure never leaves a partially rolled-forward file behind.
  //
  // Spread each source row so every column carries forward automatically
  // (including counterparty, security clauses, collateral, and the ASPE 3856
  // fair-value fields, which continue under the effective-interest method).
  // Only the identity/audit columns and the new fiscal year are overridden.
  // The `id`/`createdAt`/`updatedAt` bindings are destructured out purely to
  // exclude them from `rest`.
  const newFile = await db.transaction(async (tx) => {
    const [createdFile] = await tx
      .insert(filesTable)
      .values({
        name: originalFile.name,
        fiscalYearEnd: newFiscalYearEnd,
        clientId: originalFile.clientId,
        trivialThreshold: originalFile.trivialThreshold,
        materiality: originalFile.materiality,
      })
      .returning();

    for (const original of outstandingLoans) {
      const { id, createdAt, updatedAt, ...rest } = original;
      await tx.insert(loansTable).values({
        ...rest,
        fileId: createdFile.id,
        fiscalYearEnd: newFiscalYearEnd,
        rolledFromId: original.id,
      });
    }

    return createdFile;
  });

  const stripTime = (d: string | null): string | undefined =>
    d ? d.split("T")[0] : undefined;
  const cleanNum = (v: string | null): number | undefined => v != null ? Number(v) : undefined;

  res.status(201).json({
    ...newFile,
    fiscalYearEnd: stripTime(newFile.fiscalYearEnd) ?? newFile.fiscalYearEnd,
    trivialThreshold: cleanNum(newFile.trivialThreshold),
    materiality: cleanNum(newFile.materiality),
  });
});

export default router;
