import { Router, type IRouter } from "express";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, loansTable, filesTable } from "@workspace/db";
import {
  CreateLoanBody,
  GetLoanParams,
  GetLoanResponse,
  DeleteLoanParams,
  ListLoansResponse,
  GetFileParams,
  RollForwardLoanParams,
  RollForwardLoanBody,
  UpdateLoanParams,
  UpdateLoanBody,
  GetPrimeRateQueryParams,
  GetPrimeRateResponse,
} from "@workspace/api-zod";
import {
  computeFvSuggestion,
  fetchPrimeRate,
  type FvEvalLoanInput,
} from "../lib/fv-decisions";
import { loadAzureSettings, requireSettings, UserFacingError } from "../lib/azure-settings";
import { retrieveDocument, deleteDocumentRefSafe } from "../lib/document-store";

const router: IRouter = Router();

const stripTime = (d: string | null): string | undefined =>
  d ? d.split("T")[0] : undefined;

// Validate a stepped rent schedule: integer 1-based years, valid ranges,
// positive rent, sorted without overlaps. Returns an error message or null.
const validateRentSteps = (
  steps: Array<{ fromYear: number; toYear: number; monthlyRent: number }> | null | undefined
): string | null => {
  if (steps == null || steps.length === 0) return null;
  const sorted = [...steps].sort((a, b) => a.fromYear - b.fromYear);
  let prevToYear = 0;
  for (const s of sorted) {
    if (!Number.isInteger(s.fromYear) || !Number.isInteger(s.toYear))
      return "rentSteps years must be whole lease years";
    if (s.fromYear < 1) return "rentSteps fromYear must be 1 or greater";
    if (s.toYear < s.fromYear) return "rentSteps toYear must not be before fromYear";
    if (!(s.monthlyRent > 0)) return "rentSteps monthlyRent must be greater than zero";
    if (s.fromYear <= prevToYear) return "rentSteps ranges must not overlap";
    prevToYear = s.toYear;
  }
  return null;
};

// Normalize a DB loan row into the API response shape. Nullable columns are
// mapped to `undefined` so they are omitted from JSON, matching the OpenAPI
// contract.
const cleanLoan = (loan: typeof loansTable.$inferSelect) => ({
  ...loan,
  startDate: stripTime(loan.startDate) ?? loan.startDate,
  fiscalYearEnd: stripTime(loan.fiscalYearEnd) ?? loan.fiscalYearEnd,
  description: loan.description ?? undefined,
  assetDescription: loan.assetDescription ?? undefined,
  assetCost: loan.assetCost ?? undefined,
  assetUsefulLife: loan.assetUsefulLife ?? undefined,
  fairValue: loan.fairValue ?? undefined,
  capitalLeaseRationale: loan.capitalLeaseRationale ?? undefined,
  monthlyPayment: loan.monthlyPayment ?? undefined,
  paymentOverride: loan.paymentOverride ?? undefined,
  termMonths: loan.termMonths ?? undefined,
  isOfficeProperty: loan.isOfficeProperty ?? undefined,
  freeRentMonths: loan.freeRentMonths ?? undefined,
  rentEscalationRate: loan.rentEscalationRate ?? undefined,
  rentSteps: loan.rentSteps ?? undefined,
  tenantImprovementAllowance: loan.tenantImprovementAllowance ?? undefined,
  camMonthly: loan.camMonthly ?? undefined,
  otherInducements: loan.otherInducements ?? undefined,
  rolledFromId: loan.rolledFromId ?? undefined,
  fvRate: loan.fvRate ?? undefined,
  fvDecision: loan.fvDecision ?? undefined,
  fvDecisionNote: loan.fvDecisionNote ?? undefined,
  securityClauses: loan.securityClauses ?? undefined,
  collateralType: loan.collateralType ?? undefined,
  collateralDescription: loan.collateralDescription ?? undefined,
  collateralDepreciableCost: loan.collateralDepreciableCost ?? undefined,
  collateralLandCost: loan.collateralLandCost ?? undefined,
  collateralInServiceDate: loan.collateralInServiceDate ?? undefined,
  collateralMethod: loan.collateralMethod ?? undefined,
  collateralUsefulLifeYears: loan.collateralUsefulLifeYears ?? undefined,
  collateralDecliningRate: loan.collateralDecliningRate ?? undefined,
  collateralSalvageValue: loan.collateralSalvageValue ?? undefined,
  sourceDocumentBlob: undefined,
  sourceDocumentName: loan.sourceDocumentName ?? undefined,
});

router.get("/files/:id/loans", async (req, res): Promise<void> => {
  const params = GetFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const loans = await db
    .select()
    .from(loansTable)
    .where(and(eq(loansTable.fileId, params.data.id), isNull(loansTable.deletedAt)))
    .orderBy(loansTable.createdAt);

  res.json(loans.map(cleanLoan));
});

router.post("/files/:id/loans", async (req, res): Promise<void> => {
  const params = GetFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateLoanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;

  const rentStepsError = validateRentSteps(data.rentSteps);
  if (rentStepsError) {
    res.status(400).json({ error: rentStepsError });
    return;
  }

  const dpCreate = data.downPayment ?? 0;
  if (dpCreate < 0 || (dpCreate > 0 && dpCreate >= data.principal)) {
    res.status(400).json({ error: "downPayment must be non-negative and less than principal" });
    return;
  }

  let fvDecision = data.fvDecision ?? null;
  let fvRate = data.fvRate ?? null;

  // Auto-suggest a treatment decision when the caller hasn't already picked one.
  if (fvDecision == null) {
    const [file] = await db
      .select()
      .from(filesTable)
      .where(eq(filesTable.id, params.data.id));

    if (file) {
      const suggestion = await computeFvSuggestion(
        {
          interestRate: data.interestRate.toString(),
          principal: data.principal.toString(),
          downPayment: (data.downPayment ?? 0).toString(),
          amortizationYears: data.amortizationYears,
          termYears: data.termYears,
          startDate: data.startDate.toISOString().split("T")[0],
          ioMonths: data.ioMonths ?? 0,
          specificIoMonths: data.specificIoMonths ?? "",
          balloonPayment: (data.balloonPayment ?? 0).toString(),
          paymentFrequency: data.paymentFrequency ?? "monthly",
          fvRate: fvRate != null ? fvRate.toString() : null,
          paymentOverride: data.paymentOverride != null ? data.paymentOverride.toString() : null,
        },
        { trivialThreshold: file.trivialThreshold, materiality: file.materiality }
      );

      if (suggestion) {
        fvDecision = suggestion.fvDecision;
        fvRate = suggestion.fvRate;
      }
    }
  }

  const [loan] = await db
    .insert(loansTable)
    .values({
      fileId: params.data.id,
      name: data.name,
      description: data.description,
      counterparty: data.counterparty ?? null,
      isCapitalLease: data.isCapitalLease ?? false,
      principal: data.principal.toString(),
      downPayment: (data.downPayment ?? 0).toString(),
      interestRate: data.interestRate.toString(),
      amortizationYears: data.amortizationYears,
      termYears: data.termYears,
      startDate: data.startDate.toISOString().split("T")[0],
      fiscalYearEnd: data.fiscalYearEnd.toISOString().split("T")[0],
      paymentFrequency: data.paymentFrequency ?? "monthly",
      ioMonths: data.ioMonths ?? 0,
      specificIoMonths: data.specificIoMonths ?? "",
      balloonPayment: (data.balloonPayment ?? 0).toString(),
      transferOfOwnership: data.transferOfOwnership ?? false,
      bargainPurchaseOption: data.bargainPurchaseOption ?? false,
      leaseTermPct: (data.leaseTermPct ?? 0).toString(),
      pvPctFairValue: (data.pvPctFairValue ?? 0).toString(),
      fairValue: data.fairValue != null ? data.fairValue.toString() : null,
      specializedAsset: data.specializedAsset ?? false,
      assetDescription: data.assetDescription,
      assetCost: data.assetCost != null ? data.assetCost.toString() : null,
      assetUsefulLife: data.assetUsefulLife,
      securityClauses: data.securityClauses ?? null,
      collateralType: data.collateralType ?? null,
      collateralDescription: data.collateralDescription ?? null,
      collateralDepreciableCost:
        data.collateralDepreciableCost != null ? data.collateralDepreciableCost.toString() : null,
      collateralLandCost:
        data.collateralLandCost != null ? data.collateralLandCost.toString() : null,
      collateralInServiceDate:
        data.collateralInServiceDate != null
          ? data.collateralInServiceDate.toISOString().split("T")[0]
          : null,
      collateralMethod: data.collateralMethod ?? null,
      collateralUsefulLifeYears: data.collateralUsefulLifeYears ?? null,
      collateralDecliningRate:
        data.collateralDecliningRate != null ? data.collateralDecliningRate.toString() : null,
      collateralSalvageValue:
        data.collateralSalvageValue != null ? data.collateralSalvageValue.toString() : null,
      capitalLeaseRationale: data.capitalLeaseRationale,
      monthlyPayment: data.monthlyPayment != null ? data.monthlyPayment.toString() : null,
      paymentOverride: data.paymentOverride != null ? data.paymentOverride.toString() : null,
      termMonths: data.termMonths ?? null,
      isOfficeProperty: data.isOfficeProperty ?? false,
      freeRentMonths: data.freeRentMonths ?? 0,
      rentEscalationRate: (data.rentEscalationRate ?? 0).toString(),
      rentSteps: data.rentSteps
        ? [...data.rentSteps].sort((a, b) => a.fromYear - b.fromYear)
        : null,
      tenantImprovementAllowance: (data.tenantImprovementAllowance ?? 0).toString(),
      camMonthly: data.camMonthly != null ? data.camMonthly.toString() : null,
      otherInducements: (data.otherInducements ?? 0).toString(),
      inducementReceivedInCash: data.inducementReceivedInCash ?? false,
      covenantViolation: data.covenantViolation ?? false,
      fvRate: fvRate != null ? fvRate.toString() : null,
      fvDecision,
      fvDecisionNote: data.fvDecisionNote ?? null,
      sourceDocumentBlob: data.sourceDocumentBlob ?? null,
      sourceDocumentName: data.sourceDocumentName ?? null,
    })
    .returning();

  res.status(201).json(cleanLoan(loan));
});

router.get("/loans/:id", async (req, res): Promise<void> => {
  const params = GetLoanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [loan] = await db
    .select()
    .from(loansTable)
    .where(and(eq(loansTable.id, params.data.id), isNull(loansTable.deletedAt)));

  if (!loan) {
    res.status(404).json({ error: "Loan not found" });
    return;
  }

  res.json(cleanLoan(loan));
});

router.patch("/loans/:id", async (req, res): Promise<void> => {
  const params = UpdateLoanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateLoanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;

  if (data.downPayment != null || data.principal != null) {
    const [current] = await db
      .select({ principal: loansTable.principal, downPayment: loansTable.downPayment })
      .from(loansTable)
      .where(eq(loansTable.id, params.data.id));
    if (!current) {
      res.status(404).json({ error: "Loan not found" });
      return;
    }
    const nextDp = data.downPayment ?? Number(current.downPayment);
    const nextPrincipal = data.principal ?? Number(current.principal);
    if (nextDp < 0 || (nextDp > 0 && nextDp >= nextPrincipal)) {
      res.status(400).json({ error: "downPayment must be non-negative and less than principal" });
      return;
    }
  }

  const updates: Record<string, unknown> = {};
  if (data.name != null) updates.name = data.name;
  if (data.description != null) updates.description = data.description;
  if (data.counterparty !== undefined) updates.counterparty = data.counterparty;
  if (data.isCapitalLease != null) updates.isCapitalLease = data.isCapitalLease;
  if (data.principal != null) updates.principal = data.principal.toString();
  if (data.interestRate != null) updates.interestRate = data.interestRate.toString();
  if (data.amortizationYears != null) updates.amortizationYears = data.amortizationYears;
  if (data.termYears != null) updates.termYears = data.termYears;
  if (data.startDate != null) updates.startDate = data.startDate.toISOString().split("T")[0];
  if (data.paymentFrequency != null) updates.paymentFrequency = data.paymentFrequency;
  if (data.ioMonths != null) updates.ioMonths = data.ioMonths;
  if (data.specificIoMonths != null) updates.specificIoMonths = data.specificIoMonths;
  if (data.balloonPayment != null) updates.balloonPayment = data.balloonPayment.toString();
  if (data.transferOfOwnership != null) updates.transferOfOwnership = data.transferOfOwnership;
  if (data.bargainPurchaseOption != null) updates.bargainPurchaseOption = data.bargainPurchaseOption;
  if (data.leaseTermPct != null) updates.leaseTermPct = data.leaseTermPct.toString();
  if (data.pvPctFairValue != null) updates.pvPctFairValue = data.pvPctFairValue.toString();
  if (data.fairValue !== undefined)
    updates.fairValue = data.fairValue != null ? data.fairValue.toString() : null;
  if (data.specializedAsset != null) updates.specializedAsset = data.specializedAsset;
  if (data.assetDescription !== undefined) updates.assetDescription = data.assetDescription;
  if (data.assetCost !== undefined)
    updates.assetCost = data.assetCost != null ? data.assetCost.toString() : null;
  if (data.assetUsefulLife !== undefined) updates.assetUsefulLife = data.assetUsefulLife;
  if (data.securityClauses !== undefined) updates.securityClauses = data.securityClauses;
  if (data.dismissedFindings !== undefined) updates.dismissedFindings = data.dismissedFindings;
  if (data.collateralType !== undefined) updates.collateralType = data.collateralType;
  if (data.collateralDescription !== undefined) updates.collateralDescription = data.collateralDescription;
  if (data.collateralDepreciableCost !== undefined)
    updates.collateralDepreciableCost =
      data.collateralDepreciableCost != null ? data.collateralDepreciableCost.toString() : null;
  if (data.collateralLandCost !== undefined)
    updates.collateralLandCost =
      data.collateralLandCost != null ? data.collateralLandCost.toString() : null;
  if (data.collateralInServiceDate !== undefined)
    updates.collateralInServiceDate =
      data.collateralInServiceDate != null
        ? data.collateralInServiceDate.toISOString().split("T")[0]
        : null;
  if (data.collateralMethod !== undefined) updates.collateralMethod = data.collateralMethod;
  if (data.collateralUsefulLifeYears !== undefined)
    updates.collateralUsefulLifeYears = data.collateralUsefulLifeYears;
  if (data.collateralDecliningRate !== undefined)
    updates.collateralDecliningRate =
      data.collateralDecliningRate != null ? data.collateralDecliningRate.toString() : null;
  if (data.collateralSalvageValue !== undefined)
    updates.collateralSalvageValue =
      data.collateralSalvageValue != null ? data.collateralSalvageValue.toString() : null;
  if (data.capitalLeaseRationale !== undefined) updates.capitalLeaseRationale = data.capitalLeaseRationale;
  if (data.monthlyPayment != null) updates.monthlyPayment = data.monthlyPayment.toString();
  if (data.paymentOverride !== undefined)
    updates.paymentOverride = data.paymentOverride != null ? data.paymentOverride.toString() : null;
  if (data.downPayment !== undefined)
    updates.downPayment = data.downPayment != null ? data.downPayment.toString() : "0";
  if (data.termMonths != null) updates.termMonths = data.termMonths;
  if (data.isOfficeProperty != null) updates.isOfficeProperty = data.isOfficeProperty;
  if (data.freeRentMonths != null) updates.freeRentMonths = data.freeRentMonths;
  if (data.rentEscalationRate != null) updates.rentEscalationRate = data.rentEscalationRate.toString();
  if (data.rentSteps !== undefined) {
    const rentStepsError = validateRentSteps(data.rentSteps);
    if (rentStepsError) {
      res.status(400).json({ error: rentStepsError });
      return;
    }
    updates.rentSteps =
      data.rentSteps != null ? [...data.rentSteps].sort((a, b) => a.fromYear - b.fromYear) : null;
  }
  if (data.tenantImprovementAllowance != null) updates.tenantImprovementAllowance = data.tenantImprovementAllowance.toString();
  if (data.camMonthly !== undefined) updates.camMonthly = data.camMonthly != null ? data.camMonthly.toString() : null;
  if (data.otherInducements != null) updates.otherInducements = data.otherInducements.toString();
  if (data.inducementReceivedInCash != null) updates.inducementReceivedInCash = data.inducementReceivedInCash;
  if (data.covenantViolation != null) updates.covenantViolation = data.covenantViolation;
  if (data.fvRate != null) updates.fvRate = data.fvRate.toString();
  if (data.fvDecision != null) updates.fvDecision = data.fvDecision;
  if (data.fvDecisionNote != null) updates.fvDecisionNote = data.fvDecisionNote;

  // Re-evaluate the auto-suggested treatment decision when inputs that affect
  // the FV adjustment changed and the caller didn't explicitly pick a decision.
  const fvInputsChanged =
    data.interestRate != null ||
    data.principal != null ||
    data.amortizationYears != null ||
    data.termYears != null ||
    data.startDate != null ||
    data.ioMonths != null ||
    data.specificIoMonths != null ||
    data.balloonPayment != null ||
    data.paymentFrequency != null ||
    data.fvRate != null ||
    data.paymentOverride !== undefined ||
    data.downPayment !== undefined;

  if (data.fvDecision == null && fvInputsChanged) {
    const [existing] = await db
      .select()
      .from(loansTable)
      .where(eq(loansTable.id, params.data.id));

    if (existing) {
      const [file] = await db
        .select()
        .from(filesTable)
        .where(eq(filesTable.id, existing.fileId));

      if (file) {
        const merged: FvEvalLoanInput = {
          interestRate: (updates.interestRate as string) ?? existing.interestRate,
          principal: (updates.principal as string) ?? existing.principal,
          downPayment: (updates.downPayment as string) ?? existing.downPayment,
          amortizationYears: (updates.amortizationYears as number) ?? existing.amortizationYears,
          termYears: (updates.termYears as number) ?? existing.termYears,
          startDate: (updates.startDate as string) ?? existing.startDate,
          ioMonths: (updates.ioMonths as number) ?? existing.ioMonths,
          specificIoMonths: (updates.specificIoMonths as string) ?? existing.specificIoMonths,
          balloonPayment: (updates.balloonPayment as string) ?? existing.balloonPayment,
          paymentFrequency: (updates.paymentFrequency as string) ?? existing.paymentFrequency,
          fvRate: (updates.fvRate as string) ?? existing.fvRate,
          paymentOverride:
            data.paymentOverride !== undefined
              ? (updates.paymentOverride as string | null)
              : existing.paymentOverride,
        };

        const suggestion = await computeFvSuggestion(merged, {
          trivialThreshold: file.trivialThreshold,
          materiality: file.materiality,
        });

        if (suggestion) {
          updates.fvDecision = suggestion.fvDecision;
          updates.fvRate = suggestion.fvRate.toString();
        }
      }
    }
  }

  const [loan] = await db
    .update(loansTable)
    .set(updates)
    .where(and(eq(loansTable.id, params.data.id), isNull(loansTable.deletedAt)))
    .returning();

  if (!loan) {
    res.status(404).json({ error: "Loan not found" });
    return;
  }

  res.json(cleanLoan(loan));
});

router.delete("/loans/:id", async (req, res): Promise<void> => {
  const params = DeleteLoanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Soft delete: move to trash (recoverable). The source-document blob is
  // kept so a restored loan still has its document; blobs are cleaned up on
  // permanent deletion via the trash endpoints.
  const [loan] = await db
    .update(loansTable)
    .set({ deletedAt: new Date() })
    .where(and(eq(loansTable.id, params.data.id), isNull(loansTable.deletedAt)))
    .returning();

  if (!loan) {
    res.status(404).json({ error: "Loan not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/loans/:id/source-document", async (req, res): Promise<void> => {
  const params = GetLoanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [loan] = await db
    .select()
    .from(loansTable)
    .where(and(eq(loansTable.id, params.data.id), isNull(loansTable.deletedAt)));

  if (!loan || !loan.sourceDocumentBlob) {
    res.status(404).json({ error: "No source document for this loan" });
    return;
  }

  try {
    const settings = await loadAzureSettings();
    if (!loan.sourceDocumentBlob.startsWith("db:")) {
      requireSettings(settings, ["storageConnectionString"], "Downloading the source document");
    }
    const buffer = await retrieveDocument(settings, loan.sourceDocumentBlob);
    if (!buffer) {
      res.status(404).json({ error: "The stored document could not be found" });
      return;
    }
    const name = loan.sourceDocumentName ?? "document.pdf";
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

router.post("/loans/:id/rollforward", async (req, res): Promise<void> => {
  const params = RollForwardLoanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = RollForwardLoanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [original] = await db
    .select()
    .from(loansTable)
    .where(and(eq(loansTable.id, params.data.id), isNull(loansTable.deletedAt)));

  if (!original) {
    res.status(404).json({ error: "Loan not found" });
    return;
  }

  const data = {
    fileId: parsed.data.fileId,
    name: original.name,
    description: original.description,
    counterparty: original.counterparty,
    isCapitalLease: original.isCapitalLease,
    principal: original.principal,
    interestRate: original.interestRate,
    amortizationYears: original.amortizationYears,
    termYears: original.termYears,
    startDate: original.startDate,
    fiscalYearEnd: parsed.data.newFiscalYearEnd.toISOString().split("T")[0],
    paymentFrequency: original.paymentFrequency,
    ioMonths: original.ioMonths,
    specificIoMonths: original.specificIoMonths,
    balloonPayment: original.balloonPayment,
    transferOfOwnership: original.transferOfOwnership,
    bargainPurchaseOption: original.bargainPurchaseOption,
    leaseTermPct: original.leaseTermPct,
    pvPctFairValue: original.pvPctFairValue,
    fairValue: original.fairValue,
    specializedAsset: original.specializedAsset,
    assetDescription: original.assetDescription,
    assetCost: original.assetCost,
    assetUsefulLife: original.assetUsefulLife,
    securityClauses: original.securityClauses,
    collateralType: original.collateralType,
    collateralDescription: original.collateralDescription,
    collateralDepreciableCost: original.collateralDepreciableCost,
    collateralLandCost: original.collateralLandCost,
    collateralInServiceDate: original.collateralInServiceDate,
    collateralMethod: original.collateralMethod,
    collateralUsefulLifeYears: original.collateralUsefulLifeYears,
    collateralDecliningRate: original.collateralDecliningRate,
    collateralSalvageValue: original.collateralSalvageValue,
    capitalLeaseRationale: original.capitalLeaseRationale,
    isOfficeProperty: original.isOfficeProperty,
    freeRentMonths: original.freeRentMonths,
    rentEscalationRate: original.rentEscalationRate,
    rentSteps: original.rentSteps,
    tenantImprovementAllowance: original.tenantImprovementAllowance,
    camMonthly: original.camMonthly,
    otherInducements: original.otherInducements,
    inducementReceivedInCash: original.inducementReceivedInCash,
    covenantViolation: original.covenantViolation,
    rolledFromId: original.id,
    sourceDocumentBlob: original.sourceDocumentBlob,
    sourceDocumentName: original.sourceDocumentName,
    fvRate: original.fvRate,
    fvDecision: original.fvDecision,
    fvDecisionNote: original.fvDecisionNote,
  };

  const [loan] = await db.insert(loansTable).values(data).returning();
  res.status(201).json(cleanLoan(loan));
});

router.get("/prime-rate", async (req, res): Promise<void> => {
  const params = GetPrimeRateQueryParams.safeParse({
    date: req.query.date ? (req.query.date as string) : undefined,
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rawDate = params.data.date;
  const date = rawDate ? new Date(rawDate) : new Date();
  const dateStr = date.toISOString().split("T")[0];
  const { primeRate, source } = await fetchPrimeRate(dateStr);
  const suggestedRate = Number((primeRate + 2).toFixed(2));

  const payload: { date: Date; primeRate: number; suggestedRate: number; source: string } = {
    date,
    primeRate,
    suggestedRate,
    source,
  };
  res.json(payload);
});

router.get("/counterparties", async (_req, res): Promise<void> => {
  const rows = await db
    .selectDistinct({ counterparty: loansTable.counterparty })
    .from(loansTable)
    .where(and(isNotNull(loansTable.counterparty), isNull(loansTable.deletedAt)));

  const names = rows
    .map((r) => r.counterparty)
    .filter((c): c is string => !!c && c.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));

  res.json(names);
});

export default router;
