import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { clientsTable, db, filesTable } from "@workspace/db";
import { GetFileParams } from "@workspace/api-zod";
import { loadAzureSettings, requireSettings, UserFacingError } from "../lib/azure-settings";
import { readPdfText } from "../lib/azure-doc-intel";
import { extractLoanOrLease, reconcileLeaseMath, type LoanFields } from "../lib/azure-extract";
import { storeDocument } from "../lib/document-store";
import { fetchPrimeObservation } from "../lib/prime-rates";

const router: IRouter = Router();

const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
});

function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "The PDF is too large. Maximum size is 20 MB." });
        return;
      }
      next(err);
      return;
    }
    next();
  });
}

router.post("/files/:id/import-document", handleUpload, async (req, res): Promise<void> => {
  const params = GetFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [file] = await db
    .select()
    .from(filesTable)
    .where(eq(filesTable.id, params.data.id));
  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  const [client] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.id, file.clientId));
  if (!client) { res.status(404).json({ error: "File not found" }); return; }

  const uploaded = req.file;
  if (!uploaded) {
    res.status(400).json({ error: "No PDF file was uploaded." });
    return;
  }
  const isPdf =
    uploaded.mimetype === "application/pdf" ||
    uploaded.originalname.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    res.status(400).json({ error: "Only PDF files are supported." });
    return;
  }
  // PDF magic bytes check — catches renamed non-PDF files early.
  if (!uploaded.buffer.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
    res.status(400).json({ error: "This file doesn't appear to be a valid PDF." });
    return;
  }

  try {
    const settings = await loadAzureSettings();
    requireSettings(
      settings,
      ["docIntelEndpoint", "docIntelKey", "openaiEndpoint", "openaiKey", "openaiDeployment"],
      "PDF import",
    );

    const text = await readPdfText(settings, uploaded.buffer);
    const extraction = await extractLoanOrLease(settings, text);

    // Redo per-square-foot arithmetic server-side so small model math errors
    // never reach the accountant's schedules.
    if (extraction.classification === "lease" && extraction.lease) {
      extraction.lease = reconcileLeaseMath(extraction.lease);
    }

    // Variable-rate loans: if the document gave a prime spread but no usable
    // rate, look up the Bank of Canada prime rate and resolve the rate here.
    // Applies to a standalone loan and to each facility of a master agreement.
    const unresolvedRateFindings: Array<{ loanName: string | null; observationDate: string; reason: string; action: string }> = [];
    const resolvePrimeRate = async (loan: LoanFields, label?: string): Promise<void> => {
      if (loan.primeSpread == null) return;
      const prefix = label ? `${label}: ` : "";
      if (loan.interestRate == null) {
        const isValidDate =
          loan.startDate != null &&
          /^\d{4}-\d{2}-\d{2}$/.test(loan.startDate) &&
          !Number.isNaN(Date.parse(loan.startDate));
        const dateStr = isValidDate && loan.startDate ? loan.startDate : new Date().toISOString().slice(0, 10);
        try {
          const observation = await fetchPrimeObservation(dateStr);
          loan.statedPrimeRate = observation.rate;
          loan.interestRate = Number((observation.rate + loan.primeSpread).toFixed(2));
          extraction.reasoning = [
            extraction.reasoning,
            `${prefix}Prime-linked terms preserved. Public benchmark ${observation.sourceSeries} observed ${observation.observationDate} at ${observation.rate}% plus ${loan.primeSpread}% = ${loan.interestRate}%. Confirm it matches the lender's contractual prime.`,
          ].filter(Boolean).join(" ");
        } catch (error) {
          unresolvedRateFindings.push({
            loanName: loan.name ?? null,
            observationDate: dateStr,
            reason: error instanceof Error ? error.message : "Prime retrieval failed",
            action: "Provide an evidenced lender/current opening rate before creating the loan.",
          });
          extraction.reasoning = [
            extraction.reasoning,
            `${prefix}Unresolved rate finding: no validated public prime observation was available; no contractual fallback rate was inserted (${error instanceof Error ? error.message : "retrieval failed"}).`,
          ].filter(Boolean).join(" ");
        }
      } else if (loan.statedPrimeRate != null) {
        extraction.reasoning = [
          extraction.reasoning,
          `${prefix}Interest rate is prime + ${loan.primeSpread}%, using the prime rate of ${loan.statedPrimeRate}% stated in the document.`,
        ]
          .filter(Boolean)
          .join(" ");
      }
    };

    if (extraction.classification === "loan" && extraction.loan) {
      await resolvePrimeRate(extraction.loan);
    }
    if (extraction.classification === "master_agreement" && extraction.facilities) {
      for (const facility of extraction.facilities) {
        await resolvePrimeRate(facility, facility.name ?? undefined);
      }
    }

    // Retain the original PDF so it can be linked to the created loan/lease.
    // Goes to Azure Blob Storage when configured, otherwise to the app's own
    // database as a fallback.
    let documentId: string | null = null;
    let documentName: string | null = null;
    if (extraction.classification !== "other") {
      documentId = await storeDocument(settings, uploaded.buffer, uploaded.originalname, {
        tenantId: req.auth!.tenantId, firmId: req.auth!.firmId, clientId: client.id,
        fileId: file.id, uploaderObjectId: req.auth!.objectId,
      });
      documentName = uploaded.originalname;
    }

    res.json({
      classification: extraction.classification,
      confidence: extraction.confidence,
      reasoning: extraction.reasoning,
      documentId: documentId ?? undefined,
      documentName: documentName ?? undefined,
      unresolvedRateFindings,
      loan: extraction.classification === "loan" ? (extraction.loan ?? undefined) : undefined,
      lease: extraction.classification === "lease" ? (extraction.lease ?? undefined) : undefined,
      masterAgreement:
        extraction.classification === "master_agreement"
          ? (extraction.masterAgreement ?? undefined)
          : undefined,
      facilities:
        extraction.classification === "master_agreement"
          ? (extraction.facilities ?? [])
          : undefined,
    });
  } catch (err) {
    if (err instanceof UserFacingError) {
      req.log?.warn({ err }, "PDF import failed");
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
