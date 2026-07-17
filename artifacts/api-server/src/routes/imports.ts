import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { db, filesTable } from "@workspace/db";
import { GetFileParams } from "@workspace/api-zod";
import { loadAzureSettings, requireSettings, UserFacingError } from "../lib/azure-settings";
import { readPdfText } from "../lib/azure-doc-intel";
import { extractLoanOrLease, reconcileLeaseMath } from "../lib/azure-extract";
import { storeDocument } from "../lib/document-store";
import { fetchPrimeRate } from "../lib/fv-decisions";

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
    const loan = extraction.loan;
    if (extraction.classification === "loan" && loan && loan.primeSpread != null) {
      if (loan.interestRate == null) {
        const isValidDate =
          loan.startDate != null &&
          /^\d{4}-\d{2}-\d{2}$/.test(loan.startDate) &&
          !Number.isNaN(Date.parse(loan.startDate));
        const dateStr = isValidDate && loan.startDate ? loan.startDate : new Date().toISOString().slice(0, 10);
        const { primeRate, source } = await fetchPrimeRate(dateStr);
        loan.interestRate = Number((primeRate + loan.primeSpread).toFixed(2));
        extraction.reasoning = [
          extraction.reasoning,
          `Interest rate set to prime (${primeRate}% per ${source}, as of ${dateStr}) + ${loan.primeSpread}% = ${loan.interestRate}%. Verify against the lender's actual prime rate.`,
        ]
          .filter(Boolean)
          .join(" ");
      } else if (loan.statedPrimeRate != null) {
        extraction.reasoning = [
          extraction.reasoning,
          `Interest rate is prime + ${loan.primeSpread}%, using the prime rate of ${loan.statedPrimeRate}% stated in the document.`,
        ]
          .filter(Boolean)
          .join(" ");
      }
    }

    // Retain the original PDF so it can be linked to the created loan/lease.
    // Goes to Azure Blob Storage when configured, otherwise to the app's own
    // database as a fallback.
    let documentBlob: string | null = null;
    let documentName: string | null = null;
    if (extraction.classification !== "other") {
      documentBlob = await storeDocument(settings, uploaded.buffer, uploaded.originalname);
      documentName = uploaded.originalname;
    }

    res.json({
      classification: extraction.classification,
      confidence: extraction.confidence,
      reasoning: extraction.reasoning,
      documentBlob: documentBlob ?? undefined,
      documentName: documentName ?? undefined,
      loan: extraction.classification === "loan" ? (extraction.loan ?? undefined) : undefined,
      lease: extraction.classification === "lease" ? (extraction.lease ?? undefined) : undefined,
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
