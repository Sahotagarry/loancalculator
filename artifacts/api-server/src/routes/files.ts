import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  filesTable,
  fvDecisionConfirmationsTable,
  loanContractRevisionsTable,
  loanEventsTable,
  loanEventSetsTable,
  loansTable,
  masterAgreementsTable,
  rateResetFindingsTable,
} from "@workspace/db";
import {
  appendContractRevision,
  buildContractSnapshot,
  hashContractSnapshot,
} from "../lib/loan-contract-revisions";
import { fingerprintLoanEvents, proposedFromStored } from "../lib/loan-events";
import { isLoanOutstandingAt } from "../lib/rollforward-eligibility";
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
const ROLLFORWARD_EVIDENCE_VERSION = "2";

class RollForwardError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

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

  const file = await db.transaction(async (tx) => {
    const [updatedFile] = await tx
      .update(filesTable)
      .set(updates)
      .where(and(eq(filesTable.id, params.data.id), isNull(filesTable.deletedAt)))
      .returning();
    if (!updatedFile) return undefined;

    // The loans in this file carry a denormalized copy of the fiscal year end.
    // Update the file, every loan, and every revision projection atomically.
    if (parsed.data.fiscalYearEnd !== undefined) {
      const changedLoans = await tx
        .update(loansTable)
        .set({ fiscalYearEnd: updatedFile.fiscalYearEnd })
        .where(eq(loansTable.fileId, updatedFile.id))
        .returning();
      for (const loan of changedLoans) {
        const revisionNumber = loan.currentRevisionId
          ? (
              await tx.query.loanContractRevisionsTable.findFirst({
                where: (revision, { eq }) => eq(revision.loanId, loan.id),
                orderBy: (revision, { desc }) => desc(revision.revisionNumber),
              })
            )?.revisionNumber ?? 0
          : 0;
        await appendContractRevision(
          tx,
          loan,
          revisionNumber + 1,
          revisionNumber ? "Fiscal year end updated" : "Legacy baseline",
        );
      }
    }
    return updatedFile;
  });

  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
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

  const newFiscalYearEnd = parsed.data.newFiscalYearEnd.toISOString().split("T")[0];
  if (parsed.data.name !== undefined && !parsed.data.name.trim()) {
    res.status(400).json({ error: "name must not be blank" });
    return;
  }
  if (
    parsed.data.trivialThreshold != null &&
    parsed.data.materiality != null &&
    parsed.data.trivialThreshold > parsed.data.materiality
  ) {
    res.status(400).json({ error: "trivialThreshold must not exceed materiality" });
    return;
  }

  let outcome: {
    file: typeof filesTable.$inferSelect;
    rolledLoanCount: number;
    skippedLoanCount: number;
    idempotent: boolean;
  };
  try {
    outcome = await db.transaction(async (tx) => {
      // The source lock makes the source file, loans and evidence an authoritative
      // snapshot and serializes competing attempts for the same lineage key.
      await tx.execute(sql`select id from files where id = ${params.data.id} for update`);
      const [sourceFile] = await tx.select().from(filesTable).where(
        and(eq(filesTable.id, params.data.id), isNull(filesTable.deletedAt)),
      );
      if (!sourceFile) throw new RollForwardError("File not found", 404);
      if (newFiscalYearEnd <= sourceFile.fiscalYearEnd) {
        throw new RollForwardError(
          "newFiscalYearEnd must be after the source fiscal year end",
          400,
        );
      }
      const requestedName = parsed.data.name?.trim() ?? sourceFile.name;
      const requestedTrivial = parsed.data.trivialThreshold === undefined
        ? sourceFile.trivialThreshold
        : parsed.data.trivialThreshold?.toFixed(2) ?? null;
      const requestedMateriality = parsed.data.materiality === undefined
        ? sourceFile.materiality
        : parsed.data.materiality?.toFixed(2) ?? null;
      if (
        requestedTrivial != null &&
        requestedMateriality != null &&
        Number(requestedTrivial) > Number(requestedMateriality)
      ) {
        throw new RollForwardError(
          "trivialThreshold must not exceed materiality",
          400,
        );
      }

      const [existing] = await tx.select().from(filesTable).where(and(
        eq(filesTable.rolledFromId, sourceFile.id),
        eq(filesTable.fiscalYearEnd, newFiscalYearEnd),
        isNull(filesTable.deletedAt),
      ));
      if (existing) {
        if (
          existing.name !== requestedName ||
          existing.trivialThreshold !== requestedTrivial ||
          existing.materiality !== requestedMateriality
        ) {
          throw new RollForwardError(
            "This source file and fiscal year end were already rolled forward with different setup values",
          );
        }
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
          .from(loansTable).where(eq(loansTable.fileId, existing.id));
        const [{ count: sourceCount }] = await tx.select({ count: sql<number>`count(*)::int` })
          .from(loansTable).where(and(
            eq(loansTable.fileId, sourceFile.id),
            isNull(loansTable.deletedAt),
          ));
        return {
          file: existing,
          rolledLoanCount: count,
          skippedLoanCount: Math.max(0, sourceCount - count),
          idempotent: true,
        };
      }

      const sourceLoans = await tx.select().from(loansTable).where(and(
        eq(loansTable.fileId, sourceFile.id),
        isNull(loansTable.deletedAt),
      )).orderBy(asc(loansTable.id));
      if (sourceLoans.length) {
        await tx.execute(sql`select id from loans where file_id = ${sourceFile.id} and deleted_at is null for update`);
      }
      const sourceLoanIds = sourceLoans.map((loan) => loan.id);
      const revisions = sourceLoanIds.length
        ? await tx.select().from(loanContractRevisionsTable)
            .where(inArray(loanContractRevisionsTable.loanId, sourceLoanIds))
            .orderBy(asc(loanContractRevisionsTable.loanId), asc(loanContractRevisionsTable.revisionNumber))
        : [];
      const eventSets = sourceLoanIds.length
        ? await tx.select().from(loanEventSetsTable)
            .where(inArray(loanEventSetsTable.loanId, sourceLoanIds))
            .orderBy(asc(loanEventSetsTable.loanId), asc(loanEventSetsTable.version))
        : [];
      const events = sourceLoanIds.length
        ? await tx.select().from(loanEventsTable)
            .where(inArray(loanEventsTable.loanId, sourceLoanIds))
        : [];
      const confirmations = sourceLoanIds.length
        ? await tx.select().from(fvDecisionConfirmationsTable)
            .where(inArray(fvDecisionConfirmationsTable.loanId, sourceLoanIds))
            .orderBy(asc(fvDecisionConfirmationsTable.loanId), asc(fvDecisionConfirmationsTable.version))
        : [];
      const predecessorIds = [...new Set(
        sourceLoans.map((loan) => loan.predecessorAgreementId)
          .filter((id): id is string => id != null),
      )];
      const validPredecessors = predecessorIds.length
        ? await tx.select({ id: loansTable.id, clientId: filesTable.clientId })
            .from(loansTable)
            .innerJoin(filesTable, eq(loansTable.fileId, filesTable.id))
            .where(and(
              inArray(loansTable.id, predecessorIds),
              isNull(loansTable.deletedAt),
              isNull(filesTable.deletedAt),
            ))
        : [];
      const validPredecessorIds = new Set(
        validPredecessors
          .filter((row) => row.clientId === sourceFile.clientId)
          .map((row) => row.id),
      );
      const unresolvedRates = sourceLoanIds.length
        ? await tx.select().from(rateResetFindingsTable).where(and(
            inArray(rateResetFindingsTable.loanId, sourceLoanIds),
            eq(rateResetFindingsTable.status, "unresolved"),
            lte(rateResetFindingsTable.contractualEffectiveDate, sourceFile.fiscalYearEnd),
          ))
        : [];
      const unresolvedByLoan = new Set(unresolvedRates.map((finding) => finding.loanId));
      const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
      const setById = new Map(eventSets.map((set) => [set.id, set]));
      const eventsBySet = new Map<string, typeof events>();
      for (const event of events) {
        const grouped = eventsBySet.get(event.setId) ?? [];
        grouped.push(event);
        eventsBySet.set(event.setId, grouped);
      }

      for (const loan of sourceLoans) {
        const revision = loan.currentRevisionId
          ? revisionById.get(loan.currentRevisionId)
          : undefined;
        if (
          !revision ||
          revision.loanId !== loan.id ||
          revision.inputHash !== loan.currentRevisionHash ||
          revision.calculationVersion !== loan.calculationVersion ||
          hashContractSnapshot(buildContractSnapshot(loan)) !== loan.currentRevisionHash
        ) {
          throw new RollForwardError(
            `Loan "${loan.name}" cannot be rolled forward: finalize its current contractual revision first`,
          );
        }
        if (loan.activeEventSetId) {
          const activeSet = setById.get(loan.activeEventSetId);
          const activeEvents = eventsBySet.get(loan.activeEventSetId) ?? [];
          let eventFingerprintValid = false;
          if (activeSet) {
            try {
              eventFingerprintValid =
                fingerprintLoanEvents(
                  activeSet.termRevisionId,
                  activeEvents.map((event) => ({
                    ...proposedFromStored(event, event.supersedesEventId),
                    originEventId: event.originEventId,
                  })),
                ) === activeSet.fingerprint;
            } catch {
              eventFingerprintValid = false;
            }
          }
          if (
            !activeSet ||
            activeSet.loanId !== loan.id ||
            activeSet.termRevisionId !== loan.currentRevisionId ||
            activeSet.version !== loan.activeEventSetVersion ||
            activeSet.fingerprint !== loan.activeEventSetHash ||
            !eventFingerprintValid
          ) {
            throw new RollForwardError(
              `Loan "${loan.name}" cannot be rolled forward: its active event timeline is stale or unresolved`,
            );
          }
        }
        if (loan.rateType === "prime_linked" && unresolvedByLoan.has(loan.id)) {
          throw new RollForwardError(
            `Loan "${loan.name}" cannot be rolled forward: resolve due variable-rate observations through ${sourceFile.fiscalYearEnd}`,
          );
        }
        if (
          loan.predecessorAgreementId &&
          (!validPredecessorIds.has(loan.predecessorAgreementId) ||
            !loan.modificationEffectiveDate ||
            loan.modificationAssessment?.status !== "confirmed")
        ) {
          throw new RollForwardError(
            `Loan "${loan.name}" cannot be rolled forward: confirm its predecessor agreement transition evidence`,
          );
        }
      }

      // A confirmed successor owns the closing obligation from its effective
      // date. Suppress the predecessor so it cannot be counted twice.
      const predecessorOwnedBySuccessor = new Set(
        sourceLoans
          .filter((loan) =>
            loan.predecessorAgreementId &&
            loan.modificationAssessment?.status === "confirmed" &&
            loan.modificationEffectiveDate! <= sourceFile.fiscalYearEnd)
          .map((loan) => loan.predecessorAgreementId!),
      );
      const outstandingLoans = sourceLoans.filter((loan) => {
        if (predecessorOwnedBySuccessor.has(loan.id)) return false;
        const active = loan.activeEventSetId
          ? eventsBySet.get(loan.activeEventSetId) ?? []
          : [];
        return isLoanOutstandingAt(loan, active, sourceFile.fiscalYearEnd);
      });

      const [createdFile] = await tx.insert(filesTable).values({
        clientId: sourceFile.clientId,
        name: requestedName,
        fiscalYearEnd: newFiscalYearEnd,
        trivialThreshold: requestedTrivial,
        materiality: requestedMateriality,
        rolledFromId: sourceFile.id,
      }).returning();

      const loanIdMap = new Map(outstandingLoans.map((loan) => [loan.id, randomUUID()]));
      const requiredMasterIds = new Set(
        outstandingLoans.map((loan) => loan.masterAgreementId)
          .filter((id): id is string => id != null),
      );
      const masters = requiredMasterIds.size
        ? await tx.select().from(masterAgreementsTable).where(and(
            eq(masterAgreementsTable.fileId, sourceFile.id),
            isNull(masterAgreementsTable.deletedAt),
          ))
        : [];
      const masterIdMap = new Map<string, string>();
      for (const master of masters) {
        if (!requiredMasterIds.has(master.id)) continue;
        const targetId = randomUUID();
        masterIdMap.set(master.id, targetId);
        const { id, createdAt, updatedAt, ...rest } = master;
        await tx.insert(masterAgreementsTable).values({
          ...rest,
          id: targetId,
          fileId: createdFile.id,
          rolledFromId: id,
          sourceDocumentBlob: null,
          sourceDocumentName: null,
        });
      }

      // Generate every target identity before inserting any relationship.
      const copiedRevisions = revisions.filter((row) => loanIdMap.has(row.loanId));
      const copiedSets = eventSets.filter((row) => loanIdMap.has(row.loanId));
      const copiedEvents = events.filter((row) => loanIdMap.has(row.loanId));
      const revisionIdMap = new Map(copiedRevisions.map((row) => [row.id, randomUUID()]));
      const setIdMap = new Map(copiedSets.map((row) => [row.id, randomUUID()]));
      const eventIdMap = new Map(copiedEvents.map((row) => [row.id, randomUUID()]));

      for (const source of outstandingLoans) {
        const {
          id,
          createdAt,
          updatedAt,
          currentRevisionId,
          currentRevisionHash,
          calculationVersion,
          activeEventSetId,
          activeEventSetVersion,
          activeEventSetHash,
          ...rest
        } = source;
        await tx.insert(loansTable).values({
          ...rest,
          id: loanIdMap.get(id)!,
          fileId: createdFile.id,
          fiscalYearEnd: newFiscalYearEnd,
          rolledFromId: id,
          // Documents are owned by their original Year-End File. Do not copy
          // an opaque handle into a different file without cloning its bytes
          // and ownership record.
          sourceDocumentBlob: null,
          sourceDocumentName: null,
          // Keep the valid source predecessor until every target identity
          // exists; internal links are remapped in one second pass below.
          predecessorAgreementId: source.predecessorAgreementId,
          masterAgreementId: source.masterAgreementId
            ? masterIdMap.get(source.masterAgreementId) ?? null
            : null,
          currentRevisionId: null,
          currentRevisionHash: null,
          calculationVersion: null,
          activeEventSetId: null,
          activeEventSetVersion: 0,
          activeEventSetHash: null,
        });
      }
      for (const source of outstandingLoans) {
        const targetPredecessor = source.predecessorAgreementId
          ? loanIdMap.get(source.predecessorAgreementId)
          : undefined;
        if (targetPredecessor) {
          await tx.update(loansTable)
            .set({ predecessorAgreementId: targetPredecessor })
            .where(eq(loansTable.id, loanIdMap.get(source.id)!));
        }
      }
      for (const revision of copiedRevisions) {
        const { id, createdAt, ...rest } = revision;
        await tx.insert(loanContractRevisionsTable).values({
          ...rest,
          id: revisionIdMap.get(id)!,
          loanId: loanIdMap.get(revision.loanId)!,
        });
      }
      for (const set of copiedSets) {
        const { id, createdAt, ...rest } = set;
        await tx.insert(loanEventSetsTable).values({
          ...rest,
          id: setIdMap.get(id)!,
          loanId: loanIdMap.get(set.loanId)!,
          termRevisionId: revisionIdMap.get(set.termRevisionId)!,
          supersedesSetId: set.supersedesSetId
            ? setIdMap.get(set.supersedesSetId) ?? set.supersedesSetId
            : null,
        });
      }
      if (copiedEvents.length) {
        await tx.insert(loanEventsTable).values(copiedEvents.map((event) => {
          const { id, ...rest } = event;
          return {
            ...rest,
            id: eventIdMap.get(id)!,
            loanId: loanIdMap.get(event.loanId)!,
            setId: setIdMap.get(event.setId)!,
            termRevisionId: revisionIdMap.get(event.termRevisionId)!,
            supersedesEventId: event.supersedesEventId
              ? eventIdMap.get(event.supersedesEventId) ?? event.supersedesEventId
              : null,
            originEventId: event.originEventId
              ? eventIdMap.get(event.originEventId) ?? event.originEventId
              : event.id,
          };
        }));
      }

      for (const source of outstandingLoans) {
        const targetId = loanIdMap.get(source.id)!;
        await tx.update(loansTable).set({
          currentRevisionId: revisionIdMap.get(source.currentRevisionId!)!,
          currentRevisionHash: source.currentRevisionHash,
          calculationVersion: source.calculationVersion,
          activeEventSetId: source.activeEventSetId
            ? setIdMap.get(source.activeEventSetId)!
            : null,
          activeEventSetVersion: source.activeEventSetVersion,
          activeEventSetHash: source.activeEventSetHash,
        }).where(eq(loansTable.id, targetId));
        const [target] = await tx.select().from(loansTable).where(eq(loansTable.id, targetId));
        const nextRevision = Math.max(
          ...copiedRevisions.filter((row) => row.loanId === source.id)
            .map((row) => row.revisionNumber),
        ) + 1;
        await appendContractRevision(
          tx,
          target,
          nextRevision,
          `Rolled forward from ${sourceFile.fiscalYearEnd}`,
        );
      }

      for (const confirmation of confirmations.filter((row) => loanIdMap.has(row.loanId))) {
        const { id, ...rest } = confirmation;
        await tx.insert(fvDecisionConfirmationsTable).values({
          ...rest,
          id: randomUUID(),
          loanId: loanIdMap.get(confirmation.loanId)!,
          // Preserve the source evidence byte-for-byte and explicitly mark it
          // as historical. On later roll-forwards retain the direct immutable
          // source confirmation chain rather than losing provenance.
          sourceConfirmationId: confirmation.id,
          inheritedFromLoanId: confirmation.loanId,
          sourceFileId: sourceFile.id,
        });
      }
      return {
        file: createdFile,
        rolledLoanCount: outstandingLoans.length,
        skippedLoanCount: sourceLoans.length - outstandingLoans.length,
        idempotent: false,
      };
    });
  } catch (error) {
    if (error instanceof RollForwardError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }

  const stripTime = (d: string | null): string | undefined =>
    d ? d.split("T")[0] : undefined;
  const cleanNum = (v: string | null): number | undefined => v != null ? Number(v) : undefined;

  res.status(outcome.idempotent ? 200 : 201).json({
    ...outcome.file,
    fiscalYearEnd: stripTime(outcome.file.fiscalYearEnd) ?? outcome.file.fiscalYearEnd,
    trivialThreshold: cleanNum(outcome.file.trivialThreshold),
    materiality: cleanNum(outcome.file.materiality),
    rolledLoanCount: outcome.rolledLoanCount,
    skippedLoanCount: outcome.skippedLoanCount,
    evidenceVersion: ROLLFORWARD_EVIDENCE_VERSION,
    idempotent: outcome.idempotent,
  });
});

export default router;
