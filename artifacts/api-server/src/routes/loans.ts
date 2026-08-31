import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, loansTable, filesTable, clientMembershipsTable, clientsTable, loanContractRevisionsTable, loanEventsTable, loanEventSetsTable, masterAgreementsTable, type AgreementModificationAssessment } from "@workspace/db";
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
  ListLoanEventSetsParams,
  CreateLoanEventSetParams,
  CreateLoanEventSetBody,
  PreviewLoanEventSetParams,
  PreviewLoanEventSetBody,
  GetFvDecisionHistoryParams,
  ConfirmFvDecisionParams,
  ConfirmFvDecisionBody,
} from "@workspace/api-zod";
import { calculateAmortization, type PrincipalPaymentEvent } from "@workspace/amortization";
import {
  fetchPrimeRate,
  confirmFvDecision as persistFvDecisionConfirmation,
  getFvDecisionHistory,
  FvDecisionError,
  isDirectFvProjectionWrite,
} from "../lib/fv-decisions";
import { validatePaymentCalendar } from "../lib/loan-validation";
import { resolveInheritedSecurityClauses } from "../lib/master-link";
import { loadAzureSettings, UserFacingError } from "../lib/azure-settings";
import { documentBelongsTo, retrieveDocument } from "../lib/document-store";
import {
  appendContractRevision,
  SCHEDULE_DRIVING_FIELDS,
} from "../lib/loan-contract-revisions";
import {
  appendLoanEventSet,
  cloneActiveLoanEvents,
  ensureActiveEventSetCurrentRevision,
  EventTimelineError,
  proposedFromStored,
  validateEventSetContext,
} from "../lib/loan-events";
import {
  agreementKind,
  validateAccountingTreatmentForAgreementKind,
  validateConfirmedModificationAssessment,
  validatePredecessorChain,
  validatePredecessorRelationship,
  validateStructuredAssessmentForAgreement,
} from "../lib/modification-assessment";

const router: IRouter = Router();

// A facility can only link to a live master agreement in the same file.
// Returns an error message, or null when the link is valid.
const validateMasterLink = async (
  masterAgreementId: string,
  fileId: string,
): Promise<{ error: string | null; securityDescription: string | null }> => {
  const [master] = await db
    .select({
      id: masterAgreementsTable.id,
      fileId: masterAgreementsTable.fileId,
      securityDescription: masterAgreementsTable.securityDescription,
    })
    .from(masterAgreementsTable)
    .where(and(eq(masterAgreementsTable.id, masterAgreementId), isNull(masterAgreementsTable.deletedAt)));
  if (!master) return { error: "Master agreement not found", securityDescription: null };
  if (master.fileId !== fileId)
    return { error: "Master agreement belongs to a different year-end file", securityDescription: null };
  return { error: null, securityDescription: master.securityDescription };
};

type AgreementLinkTarget = {
  id?: string;
  fileId: string;
  startDate: string;
  isCapitalLease: boolean;
  interestRate: string | number;
  monthlyPayment: string | number | null;
  termMonths: number | null;
};

const persistModificationAssessment = (
  assessment: Record<string, unknown>,
): AgreementModificationAssessment => {
  const evidence = assessment.evidence as Record<string, unknown> | undefined;
  const quantitativeTest = evidence?.quantitativeTest as Record<string, unknown> | null | undefined;
  const conclusion = assessment.conclusion as Record<string, unknown> | undefined;
  const leaseTransition = conclusion?.leaseTransition as Record<string, unknown> | undefined;
  const dateOnly = (value: unknown) =>
    value instanceof Date ? value.toISOString().slice(0, 10) : value;
  const cashFlows = (flows: unknown) =>
    Array.isArray(flows)
      ? flows.map((flow) =>
          flow && typeof flow === "object"
            ? { ...(flow as Record<string, unknown>), date: dateOnly((flow as Record<string, unknown>).date) }
            : flow,
        )
      : flows;
  return {
  ...assessment,
  assessmentDate:
    dateOnly(assessment.assessmentDate),
  confirmedAt:
    assessment.confirmedAt instanceof Date
      ? assessment.confirmedAt.toISOString()
      : assessment.confirmedAt,
  evidence: evidence
    ? {
        ...evidence,
        quantitativeTest: quantitativeTest
          ? {
              ...quantitativeTest,
              originalRemainingCashFlows: cashFlows(quantitativeTest.originalRemainingCashFlows),
              modifiedCashFlows: cashFlows(quantitativeTest.modifiedCashFlows),
            }
          : quantitativeTest,
      }
    : evidence,
  conclusion: conclusion
    ? {
        ...conclusion,
        leaseTransition: leaseTransition
          ? { ...leaseTransition, entryDate: dateOnly(leaseTransition.entryDate) }
          : leaseTransition,
      }
    : conclusion,
} as unknown as AgreementModificationAssessment;
};

// Agreement lineage is always selected explicitly. It is not derived from a
// similar name, counterparty, master facility, or annual roll-forward link.
const validatePredecessorLink = async (
  predecessorAgreementId: string,
  target: AgreementLinkTarget,
  modificationEffectiveDate: string,
  modificationAssessment: unknown,
): Promise<string | null> => {
  const [targetFile] = await db
    .select({ clientId: filesTable.clientId })
    .from(filesTable)
    .where(and(eq(filesTable.id, target.fileId), isNull(filesTable.deletedAt)));
  if (!targetFile) return "Target year-end file not found";

  const [predecessor] = await db
    .select({
      id: loansTable.id,
      clientId: filesTable.clientId,
      isCapitalLease: loansTable.isCapitalLease,
      interestRate: loansTable.interestRate,
      monthlyPayment: loansTable.monthlyPayment,
      termMonths: loansTable.termMonths,
      startDate: loansTable.startDate,
      fvRate: loansTable.fvRate,
      fvDecision: loansTable.fvDecision,
    })
    .from(loansTable)
    .innerJoin(filesTable, eq(loansTable.fileId, filesTable.id))
    .where(
      and(
        eq(loansTable.id, predecessorAgreementId),
        isNull(loansTable.deletedAt),
        isNull(filesTable.deletedAt),
      ),
    );
  if (!predecessor) return "Predecessor agreement not found";
  const relationshipError = validatePredecessorRelationship({
    targetId: target.id,
    targetClientId: targetFile.clientId,
    targetKind: agreementKind(target),
    predecessorId: predecessor.id,
    predecessorClientId: predecessor.clientId,
    predecessorKind: agreementKind(predecessor),
  });
  if (relationshipError) return relationshipError;
  const assessmentError = validateStructuredAssessmentForAgreement({
    assessment: modificationAssessment,
    kind: agreementKind(target),
    predecessorStartDate: predecessor.startDate,
    predecessorLeaseType: predecessor.isCapitalLease ? "capital" : "operating",
    successorLeaseType: target.isCapitalLease ? "capital" : "operating",
    predecessorOriginalEffectiveRate:
      predecessor.fvDecision === "use_fv" && predecessor.fvRate != null
        ? Number(predecessor.fvRate)
        : Number(predecessor.interestRate),
    modificationEffectiveDate,
    successorStartDate: target.startDate,
  });
  if (assessmentError) return assessmentError;

  const visited = new Set<string>();
  let cursor: string | null = predecessor.id;
  const chain: string[] = [];
  while (cursor) {
    chain.push(cursor);
    if (visited.has(cursor)) {
      break;
    }
    visited.add(cursor);
    const [row]: Array<{ predecessorAgreementId: string | null }> = await db
      .select({ predecessorAgreementId: loansTable.predecessorAgreementId })
      .from(loansTable)
      .where(eq(loansTable.id, cursor))
      .limit(1);
    cursor = row?.predecessorAgreementId ?? null;
  }
  return validatePredecessorChain(target.id, chain);
};

const validateModificationFields = (
  predecessorAgreementId: string | null | undefined,
  modificationEffectiveDate: string | null | undefined,
  modificationAssessment: unknown,
): string | null => {
  const values = [predecessorAgreementId, modificationEffectiveDate, modificationAssessment];
  if (values.every((value) => value == null)) return null;
  if (values.some((value) => value == null)) {
    return "predecessorAgreementId, modificationEffectiveDate, and modificationAssessment must be supplied together";
  }
  return validateConfirmedModificationAssessment(modificationAssessment);
};

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

const validateRateTerms = (data: {
  rateType?: "fixed" | "prime_linked";
  rateBenchmark?: string | null;
  contractualPrimeName?: string | null;
  benchmarkEquivalentToContractualPrime?: boolean | null;
  rateSpread?: number | null;
  rateResetFrequency?: string | null;
  rateEffectiveConvention?: string | null;
  ratePaymentTreatment?: string | null;
  initialFvRateAssumption?: Record<string, unknown> | null;
}): string | null => {
  if ((data.rateType ?? "fixed") === "fixed") return null;
  if (!data.rateBenchmark) return "Prime-linked loans require a benchmark identity";
  if (!data.contractualPrimeName) return "Prime-linked loans require the lender's contractual prime name";
  if (data.benchmarkEquivalentToContractualPrime == null) {
    return "Prime-linked loans require confirmation whether the public benchmark equals the lender contractual prime";
  }
  if (data.rateSpread == null || !Number.isFinite(data.rateSpread)) return "Prime-linked loans require a contractual spread";
  if (!data.rateResetFrequency || !data.rateEffectiveConvention || !data.ratePaymentTreatment) {
    return "Prime-linked loans require reset timing, effective convention, and payment treatment";
  }
  if (!data.initialFvRateAssumption || Object.keys(data.initialFvRateAssumption).length === 0) {
    return "Prime-linked loans require frozen day-one fair-value assumption evidence";
  }
  return null;
};

// Normalize a DB loan row into the API response shape. Nullable columns are
// mapped to `undefined` so they are omitted from JSON, matching the OpenAPI
// contract.
const cleanLoan = (
  loan: typeof loansTable.$inferSelect,
  activeEvents: ReturnType<typeof cleanEvent>[] = [],
  activeRateEvents: ReturnType<typeof cleanRateEvent>[] = [],
) => ({
  ...loan,
  startDate: stripTime(loan.startDate) ?? loan.startDate,
  fiscalYearEnd: stripTime(loan.fiscalYearEnd) ?? loan.fiscalYearEnd,
  firstPaymentDate: stripTime(loan.firstPaymentDate) ?? undefined,
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
  predecessorAgreementId: loan.predecessorAgreementId ?? undefined,
  modificationEffectiveDate:
    stripTime(loan.modificationEffectiveDate) ?? undefined,
  modificationAssessment: loan.modificationAssessment ?? undefined,
  masterAgreementId: loan.masterAgreementId ?? undefined,
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
  activeEventSetId: loan.activeEventSetId ?? undefined,
  activeEventSetHash: loan.activeEventSetHash ?? undefined,
  activeEvents,
  activeRateEvents,
});

const cleanEvent = (event: typeof loanEventsTable.$inferSelect) => ({
  ...event,
  effectiveDate: stripTime(event.effectiveDate) ?? event.effectiveDate,
  amount: Number(event.amount),
});
const cleanRateEvent = (event: typeof loanEventsTable.$inferSelect) => ({
  ...event,
  effectiveDate: stripTime(event.effectiveDate) ?? event.effectiveDate,
  observationDate: stripTime(event.observationDate) ?? event.observationDate,
  publishedDate: stripTime(event.publishedDate) ?? event.publishedDate,
  amount: undefined,
  benchmarkRate: Number(event.benchmarkRate),
  spread: Number(event.spread),
  resultingRate: Number(event.resultingRate),
});

const canonicalEventOrder = (a: typeof loanEventsTable.$inferSelect, b: typeof loanEventsTable.$inferSelect) =>
  a.effectiveDate.localeCompare(b.effectiveDate) ||
  (a.ordering === "before_scheduled_payment" ? 0 : 1) -
    (b.ordering === "before_scheduled_payment" ? 0 : 1) ||
  a.sequence - b.sequence;

// One query serves an entire list response; only events belonging to each
// loan's projected active set are exposed as schedule evidence.
const loadActiveEvents = async (loans: Array<typeof loansTable.$inferSelect>) => {
  const activeSetIds = loans
    .map((loan) => loan.activeEventSetId)
    .filter((id): id is string => id != null);
  const events = activeSetIds.length
    ? await db.select().from(loanEventsTable).where(inArray(loanEventsTable.setId, activeSetIds))
    : [];
  const byLoan = new Map<string, { principal: ReturnType<typeof cleanEvent>[]; rates: ReturnType<typeof cleanRateEvent>[] }>();
  for (const loan of loans) {
    const active = loan.activeEventSetId
      ? events
          .filter(
            (event) =>
              event.loanId === loan.id &&
              event.setId === loan.activeEventSetId &&
              event.kind === "principal_prepayment",
          )
          .sort(canonicalEventOrder)
          .map(cleanEvent)
      : [];
    byLoan.set(loan.id, {
      principal: active,
      rates: loan.activeEventSetId
        ? events.filter((event) => event.loanId === loan.id && event.setId === loan.activeEventSetId && event.kind === "rate_reset").sort(canonicalEventOrder).map(cleanRateEvent)
        : [],
    });
  }
  return byLoan;
};

const engineEvents = (
  events: Array<Pick<typeof loanEventsTable.$inferSelect, "id" | "effectiveDate" | "ordering" | "sequence" | "amount" | "treatment">>,
): PrincipalPaymentEvent[] =>
  events.filter((event) => event.amount != null).map((event) => ({
    id: event.id,
    effectiveDate: new Date(`${stripTime(event.effectiveDate) ?? event.effectiveDate}T00:00:00Z`),
    ordering: event.ordering as PrincipalPaymentEvent["ordering"],
    sequence: event.sequence,
    amount: Number(event.amount),
    treatment: event.treatment as PrincipalPaymentEvent["treatment"],
  }));

const previewMetrics = (
  loan: typeof loansTable.$inferSelect,
  events: PrincipalPaymentEvent[],
) => {
  const calculate = (principalEvents: PrincipalPaymentEvent[]) => calculateAmortization(
    Number(loan.principal) - Number(loan.downPayment),
    Number(loan.interestRate),
    loan.amortizationYears,
    loan.termYears,
    new Date(`${stripTime(loan.startDate) ?? loan.startDate}T00:00:00Z`),
    loan.ioMonths,
    loan.specificIoMonths ? loan.specificIoMonths.split(",").map(Number).filter(Number.isFinite) : [],
    Number(loan.balloonPayment),
    loan.paymentFrequency as "monthly" | "semi-monthly" | "bi-weekly" | "weekly",
    loan.paymentOverride == null ? null : Number(loan.paymentOverride),
    loan.graceMonths,
    loan.graceInterestTreatment === "none" ? "none" : "capitalized",
    {
      paymentTiming: loan.paymentTiming === "beginning" ? "beginning" : "end",
      graceTermMode: loan.graceTermMode === "added" ? "added" : "included",
      firstPaymentDate: loan.firstPaymentDate
        ? new Date(`${stripTime(loan.firstPaymentDate)}T00:00:00Z`)
        : undefined,
      semiMonthlyDueDays:
        loan.semiMonthlyFirstDueDay != null && loan.semiMonthlySecondDueDay != null
          ? [loan.semiMonthlyFirstDueDay, loan.semiMonthlySecondDueDay]
          : undefined,
      principalEvents,
    },
  );
  const baseline = calculate([]);
  const result = events.length ? calculate(events) : baseline;
  const final = result.schedule.at(-1);
  return {
    nextRegularPayment: result.monthlyPayment,
    payoffDate: final ? final.date.toISOString().slice(0, 10) : null,
    contractualMaturity: baseline.schedule.at(-1)?.date.toISOString().slice(0, 10) ?? null,
    totalInterest: result.totalInterest,
    endingBalance: final?.balance ?? 0,
  };
};

router.get("/files/:id/loans", async (req, res): Promise<void> => {
  const params = GetFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const loans = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(loansTable)
      .where(and(eq(loansTable.fileId, params.data.id), isNull(loansTable.deletedAt)))
      .orderBy(loansTable.createdAt);
    const normalized = [];
    for (const row of rows) {
      normalized.push(
        row.currentRevisionId
          ? row
          : await appendContractRevision(tx, row, 1, "Legacy baseline"),
      );
    }
    return Promise.all(normalized.map((loan) => ensureActiveEventSetCurrentRevision(tx, loan)));
  });

  const activeEvents = await loadActiveEvents(loans);
  res.json(loans.map((loan) => cleanLoan(loan, activeEvents.get(loan.id)?.principal, activeEvents.get(loan.id)?.rates)));
});

router.post("/files/:id/loans", async (req, res): Promise<void> => {
  const params = GetFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (isDirectFvProjectionWrite(req.body)) {
    res.status(409).json({
      error: "Create the loan first, then confirm FV treatment through POST /loans/:id/fv-decisions with expectedVersion.",
    });
    return;
  }

  const parsed = CreateLoanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  if ("sourceDocumentBlob" in (req.body as Record<string, unknown>)) {
    res.status(400).json({ error: "sourceDocumentBlob is not accepted; use sourceDocumentId" }); return;
  }
  if (data.sourceDocumentId) {
    const [parent] = await db.select({ clientId: filesTable.clientId }).from(filesTable).where(eq(filesTable.id, params.data.id));
    const document = parent ? await documentBelongsTo(data.sourceDocumentId, {
      tenantId: req.auth!.tenantId, firmId: req.auth!.firmId, clientId: parent.clientId, fileId: params.data.id,
    }) : null;
    if (!document) { res.status(400).json({ error: "sourceDocumentId does not belong to this file" }); return; }
  }
  const persistedAssessment = data.modificationAssessment
    ? persistModificationAssessment(data.modificationAssessment)
    : data.modificationAssessment;
  const modificationError = validateModificationFields(
    data.predecessorAgreementId,
    data.modificationEffectiveDate?.toISOString().slice(0, 10),
    persistedAssessment,
  );
  if (modificationError) {
    res.status(400).json({ error: modificationError });
    return;
  }
  if (data.predecessorAgreementId) {
    const predecessorError = await validatePredecessorLink(data.predecessorAgreementId, {
      fileId: params.data.id,
      startDate: data.startDate.toISOString().slice(0, 10),
      isCapitalLease: data.isCapitalLease ?? false,
      interestRate: data.interestRate,
      monthlyPayment: data.monthlyPayment ?? null,
      termMonths: data.termMonths ?? null,
    }, data.modificationEffectiveDate!.toISOString().slice(0, 10), persistedAssessment);
    if (predecessorError) {
      res.status(400).json({ error: predecessorError });
      return;
    }
    const treatmentError = validateAccountingTreatmentForAgreementKind(
      persistedAssessment,
      agreementKind({
        isCapitalLease: data.isCapitalLease ?? false,
        interestRate: data.interestRate,
        monthlyPayment: data.monthlyPayment ?? null,
        termMonths: data.termMonths ?? null,
      }),
    );
    if (treatmentError) {
      res.status(400).json({ error: treatmentError });
      return;
    }
  }
  if (!Number.isFinite(data.interestRate) || data.interestRate < 0) {
    res.status(400).json({ error: "interestRate must be a finite opening contractual rate of zero or greater" });
    return;
  }
  if (
    data.initialEvents?.length &&
    (!data.initialEventSetReason?.trim() || !data.initialEventSetSource?.trim())
  ) {
    res.status(400).json({
      error: "initialEventSetReason and initialEventSetSource are required when initialEvents are provided",
    });
    return;
  }

  const rentStepsError = validateRentSteps(data.rentSteps);
  if (rentStepsError) {
    res.status(400).json({ error: rentStepsError });
    return;
  }
  const rateTermsError = validateRateTerms(data);
  if (rateTermsError) {
    res.status(400).json({ error: rateTermsError });
    return;
  }
  if (data.rateType === "prime_linked" && data.rateBenchmark !== "boc_v80691311") {
    res.status(400).json({ error: "New prime-linked contracts must explicitly adopt boc_v80691311" });
    return;
  }

  const dpCreate = data.downPayment ?? 0;
  if (dpCreate < 0 || (dpCreate > 0 && dpCreate >= data.principal)) {
    res.status(400).json({ error: "downPayment must be non-negative and less than principal" });
    return;
  }

  const paymentCalendarError = validatePaymentCalendar({
    paymentFrequency: data.paymentFrequency ?? "monthly",
    semiMonthlyFirstDueDay: data.semiMonthlyFirstDueDay ?? null,
    semiMonthlySecondDueDay: data.semiMonthlySecondDueDay ?? null,
    startDate: data.startDate.toISOString().split("T")[0],
    firstPaymentDate: data.firstPaymentDate?.toISOString().split("T")[0] ?? null,
    termYears: data.termYears,
    termMonths: data.termMonths ?? null,
    graceMonths: data.graceMonths ?? 0,
    graceTermMode: data.graceTermMode ?? "included",
  });
  if (paymentCalendarError) {
    res.status(400).json({ error: paymentCalendarError });
    return;
  }

  let inheritedSecurityClauses: string[] | null = null;
  if (data.masterAgreementId != null) {
    const link = await validateMasterLink(data.masterAgreementId, params.data.id);
    if (link.error) {
      res.status(400).json({ error: link.error });
      return;
    }
    // Copy-on-link: when the facility supplies no security wording of its own,
    // persist the master's shared wording onto the facility so the disclosure
    // survives a later master deletion/unlink.
    inheritedSecurityClauses = resolveInheritedSecurityClauses(
      data.securityClauses,
      null,
      link.securityDescription,
    );
  }

  let loan: typeof loansTable.$inferSelect;
  try {
    loan = await db.transaction(async (tx) => {
    const [created] = await tx.insert(loansTable).values({
      fileId: params.data.id,
      name: data.name,
      description: data.description,
      counterparty: data.counterparty ?? null,
      isCapitalLease: data.isCapitalLease ?? false,
      principal: data.principal.toString(),
      downPayment: (data.downPayment ?? 0).toString(),
      interestRate: data.interestRate.toString(),
      rateType: data.rateType ?? "fixed",
      rateBenchmark: data.rateBenchmark ?? null,
      contractualPrimeName: data.contractualPrimeName ?? null,
      benchmarkEquivalentToContractualPrime: data.benchmarkEquivalentToContractualPrime ?? null,
      rateSpread: data.rateSpread != null ? data.rateSpread.toString() : null,
      rateResetFrequency: data.rateResetFrequency ?? null,
      rateEffectiveConvention: data.rateEffectiveConvention ?? null,
      ratePaymentTreatment: data.ratePaymentTreatment ?? null,
      initialFvRateAssumption: data.initialFvRateAssumption ?? null,
      amortizationYears: data.amortizationYears,
      termYears: data.termYears,
      startDate: data.startDate.toISOString().split("T")[0],
      fiscalYearEnd: data.fiscalYearEnd.toISOString().split("T")[0],
      paymentFrequency: data.paymentFrequency ?? "monthly",
      paymentTiming: data.paymentTiming ?? "end",
      graceTermMode: data.graceTermMode ?? "included",
      firstPaymentDate:
        data.firstPaymentDate != null
          ? data.firstPaymentDate.toISOString().split("T")[0]
          : null,
      semiMonthlyFirstDueDay: data.semiMonthlyFirstDueDay ?? null,
      semiMonthlySecondDueDay: data.semiMonthlySecondDueDay ?? null,
      ioMonths: data.ioMonths ?? 0,
      specificIoMonths: data.specificIoMonths ?? "",
      graceMonths: data.graceMonths ?? 0,
      graceInterestTreatment: data.graceInterestTreatment ?? "capitalized",
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
      securityClauses: data.securityClauses?.length ? data.securityClauses : (inheritedSecurityClauses ?? data.securityClauses ?? null),
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
      fvRate: null,
      fvDecision: null,
      fvDecisionNote: null,
       sourceDocumentBlob: data.sourceDocumentId ?? null,
      sourceDocumentName: data.sourceDocumentName ?? null,
      masterAgreementId: data.masterAgreementId ?? null,
      predecessorAgreementId: data.predecessorAgreementId ?? null,
      modificationEffectiveDate:
        data.modificationEffectiveDate?.toISOString().slice(0, 10) ?? null,
      modificationAssessment: persistedAssessment ?? null,
    }).returning();
    const projected = await appendContractRevision(
      tx,
      created,
      1,
      data.changeReason?.trim() || "Loan created",
    );
    if (data.initialEvents?.length) {
      const initialInput = {
        expectedVersion: 0,
        termRevisionId: projected.currentRevisionId!,
        reason: data.initialEventSetReason!,
        source: data.initialEventSetSource!,
        events: data.initialEvents,
      };
      const validated = await validateEventSetContext(tx, projected.id, initialInput);
      try {
        previewMetrics(
          validated.loan,
          validated.events.filter((event) => event.kind === "principal_prepayment").map((event) => ({
            id: `initial-${event.sequence}`,
            effectiveDate: new Date(`${event.effectiveDate}T00:00:00Z`),
            ordering: event.ordering,
            sequence: event.sequence,
            amount: event.amount,
            treatment: event.treatment,
          })),
        );
      } catch (error) {
        throw new EventTimelineError(
          error instanceof Error
            ? `Initial event timeline cannot be scheduled: ${error.message}`
            : "Initial event timeline cannot be scheduled",
        );
      }
      await appendLoanEventSet(tx, projected.id, initialInput);
    }
    const [withEvents] = await tx.select().from(loansTable).where(eq(loansTable.id, projected.id));
    return withEvents;
  });
  } catch (error) {
    if (error instanceof EventTimelineError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }

  const activeEvents = await loadActiveEvents([loan]);
  res.status(201).json(cleanLoan(loan, activeEvents.get(loan.id)?.principal, activeEvents.get(loan.id)?.rates));
});

router.get("/loans/:id", async (req, res): Promise<void> => {
  const params = GetLoanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const loan = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(loansTable)
      .where(and(eq(loansTable.id, params.data.id), isNull(loansTable.deletedAt)));
    if (!row) return row;
    const revisioned = row.currentRevisionId
      ? row
      : await appendContractRevision(tx, row, 1, "Legacy baseline");
    return ensureActiveEventSetCurrentRevision(tx, revisioned);
  });

  if (!loan) {
    res.status(404).json({ error: "Loan not found" });
    return;
  }

  const activeEvents = await loadActiveEvents([loan]);
  res.json(cleanLoan(loan, activeEvents.get(loan.id)?.principal, activeEvents.get(loan.id)?.rates));
});

router.get("/loans/:id/event-sets", async (req, res): Promise<void> => {
  const params = ListLoanEventSetsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [loan] = await db
    .select({ id: loansTable.id, activeEventSetId: loansTable.activeEventSetId })
    .from(loansTable)
    .where(and(eq(loansTable.id, params.data.id), isNull(loansTable.deletedAt)));
  if (!loan) {
    res.status(404).json({ error: "Loan not found" });
    return;
  }
  const sets = await db
    .select()
    .from(loanEventSetsTable)
    .where(eq(loanEventSetsTable.loanId, loan.id))
    .orderBy(desc(loanEventSetsTable.version));
  const events = await db
    .select()
    .from(loanEventsTable)
    .where(eq(loanEventsTable.loanId, loan.id))
    .orderBy(asc(loanEventsTable.sequence));
  const expanded = sets.map((set) => ({
    ...set,
    // Task 29 endpoint remains principal-event compatible. Rate history is
    // available from /rate-timeline without weakening this response contract.
    events: events
      .filter((event) => event.setId === set.id && event.kind === "principal_prepayment")
      .map(cleanEvent),
  }));
  res.json({
    active: expanded.find((set) => set.id === loan.activeEventSetId) ?? null,
    history: expanded,
  });
});

router.get("/loans/:id/fv-decisions", async (req, res): Promise<void> => {
  const params = GetFvDecisionHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    res.json(await getFvDecisionHistory(params.data.id));
  } catch (error) {
    if (error instanceof FvDecisionError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/loans/:id/fv-decisions", async (req, res): Promise<void> => {
  const params = ConfirmFvDecisionParams.safeParse(req.params);
  const body = ConfirmFvDecisionBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const confirmation = await persistFvDecisionConfirmation(params.data.id, body.data);
    res.status(201).json(confirmation);
  } catch (error) {
    if (error instanceof FvDecisionError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/loans/:id/event-sets/preview", async (req, res): Promise<void> => {
  const params = PreviewLoanEventSetParams.safeParse(req.params);
  const body = PreviewLoanEventSetBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const preview = await db.transaction(async (tx) => {
      const validated = await validateEventSetContext(tx, params.data.id, body.data);
      const currentEvents = validated.loan.activeEventSetId
        ? await tx
            .select()
            .from(loanEventsTable)
            .where(eq(loanEventsTable.setId, validated.loan.activeEventSetId))
            .orderBy(asc(loanEventsTable.sequence))
        : [];
      return { ...validated, currentEvents };
    });
    const proposedEngineEvents: PrincipalPaymentEvent[] = preview.events
      .filter((event) => event.kind === "principal_prepayment")
      .map((event) => ({
      id: `preview-${event.sequence}`,
      effectiveDate: new Date(`${event.effectiveDate}T00:00:00Z`),
      ordering: event.ordering,
      sequence: event.sequence,
      amount: event.amount,
      treatment: event.treatment,
    }));
    let before;
    let after;
    try {
      before = previewMetrics(preview.loan, engineEvents(preview.currentEvents));
      after = previewMetrics(preview.loan, proposedEngineEvents);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? `Event timeline cannot be scheduled: ${error.message}` : "Event timeline cannot be scheduled",
      });
      return;
    }
    res.json({
      valid: true,
      nextVersion: preview.nextVersion,
      fingerprint: preview.fingerprint,
      termRevisionId: body.data.termRevisionId,
      orderedEvents: preview.events,
      evidence: {
        currentTermRevisionId: preview.loan.currentRevisionId,
        supersedesSetId: preview.loan.activeEventSetId,
        structuralOnly: false,
      },
      before,
      after,
    });
  } catch (error) {
    if (error instanceof EventTimelineError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/loans/:id/event-sets", async (req, res): Promise<void> => {
  const params = CreateLoanEventSetParams.safeParse(req.params);
  const body = CreateLoanEventSetBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const set = await db.transaction(async (tx) => {
      const [loanProjection] = await tx
        .select()
        .from(loansTable)
        .where(eq(loansTable.id, params.data.id));
      const active = loanProjection?.activeEventSetId
        ? await tx
            .select()
            .from(loanEventsTable)
            .where(eq(loanEventsTable.setId, loanProjection.activeEventSetId))
        : [];
      const maxPrincipalSequence = Math.max(0, ...body.data.events.map((event) => event.sequence));
      const preservedRates = active
        .filter((event) => event.kind === "rate_reset")
        .sort(canonicalEventOrder)
        .map((event, index) => ({
          ...proposedFromStored(event, null),
          sequence: maxPrincipalSequence + index + 1,
        }));
      const completeInput = {
        ...body.data,
        events: [...body.data.events, ...preservedRates],
      };
      // Persist only event sets the same engine can schedule. This closes the
      // gap where a caller could skip preview and save an out-of-term or
      // overpaying event directly.
      const validated = await validateEventSetContext(tx, params.data.id, completeInput);
      try {
        previewMetrics(
          validated.loan,
          validated.events.filter((event) => event.kind === "principal_prepayment").map((event) => ({
            id: `pending-${event.sequence}`,
            effectiveDate: new Date(`${event.effectiveDate}T00:00:00Z`),
            ordering: event.ordering,
            sequence: event.sequence,
            amount: event.amount,
            treatment: event.treatment,
          })),
        );
      } catch (error) {
        throw new EventTimelineError(
          error instanceof Error
            ? `Event timeline cannot be scheduled: ${error.message}`
            : "Event timeline cannot be scheduled",
        );
      }
      return appendLoanEventSet(tx, params.data.id, completeInput);
    });
    res.status(201).json({
      ...set,
      events: set.events
        .filter((event) => event.kind === "principal_prepayment")
        .map(cleanEvent),
    });
  } catch (error) {
    if (error instanceof EventTimelineError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.patch("/loans/:id", async (req, res): Promise<void> => {
  const params = UpdateLoanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // These are an immutable-confirmation projection, never an editable loan
  // field. Check raw input before Zod can strip removed legacy properties.
  if (isDirectFvProjectionWrite(req.body)) {
    res.status(409).json({
      error: "FV treatment, rate, and rationale are confirmed only through POST /loans/:id/fv-decisions with expectedVersion.",
    });
    return;
  }

  const parsed = UpdateLoanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const [calendarCurrent] = await db
    .select({
      paymentFrequency: loansTable.paymentFrequency,
      semiMonthlyFirstDueDay: loansTable.semiMonthlyFirstDueDay,
      semiMonthlySecondDueDay: loansTable.semiMonthlySecondDueDay,
      startDate: loansTable.startDate,
      firstPaymentDate: loansTable.firstPaymentDate,
      termYears: loansTable.termYears,
      termMonths: loansTable.termMonths,
      graceMonths: loansTable.graceMonths,
      graceTermMode: loansTable.graceTermMode,
      rateType: loansTable.rateType,
      rateBenchmark: loansTable.rateBenchmark,
      contractualPrimeName: loansTable.contractualPrimeName,
      benchmarkEquivalentToContractualPrime: loansTable.benchmarkEquivalentToContractualPrime,
      rateSpread: loansTable.rateSpread,
      rateResetFrequency: loansTable.rateResetFrequency,
      rateEffectiveConvention: loansTable.rateEffectiveConvention,
      ratePaymentTreatment: loansTable.ratePaymentTreatment,
      initialFvRateAssumption: loansTable.initialFvRateAssumption,
      id: loansTable.id,
      fileId: loansTable.fileId,
      isCapitalLease: loansTable.isCapitalLease,
      interestRate: loansTable.interestRate,
      monthlyPayment: loansTable.monthlyPayment,
      predecessorAgreementId: loansTable.predecessorAgreementId,
      modificationEffectiveDate: loansTable.modificationEffectiveDate,
      modificationAssessment: loansTable.modificationAssessment,
    })
    .from(loansTable)
    .where(and(eq(loansTable.id, params.data.id), isNull(loansTable.deletedAt)));
  if (!calendarCurrent) {
    res.status(404).json({ error: "Loan not found" });
    return;
  }
  const modificationFieldsTouched =
    data.predecessorAgreementId !== undefined ||
    data.modificationEffectiveDate !== undefined ||
    data.modificationAssessment !== undefined;
  const predecessorCompatibilityTouched =
    modificationFieldsTouched ||
    data.isCapitalLease !== undefined ||
    data.interestRate !== undefined ||
    data.monthlyPayment !== undefined ||
    data.termMonths !== undefined;
  const nextPredecessor =
    data.predecessorAgreementId === undefined
      ? calendarCurrent.predecessorAgreementId
      : data.predecessorAgreementId;
  const nextModificationDate =
    data.modificationEffectiveDate === undefined
      ? calendarCurrent.modificationEffectiveDate
      : data.modificationEffectiveDate?.toISOString().slice(0, 10) ?? null;
  const nextAssessment =
    data.modificationAssessment === undefined
      ? calendarCurrent.modificationAssessment
      : data.modificationAssessment == null
        ? null
        : persistModificationAssessment(data.modificationAssessment);
  if (predecessorCompatibilityTouched) {
    const modificationError = validateModificationFields(
      nextPredecessor,
      nextModificationDate,
      nextAssessment,
    );
    if (modificationError) {
      res.status(400).json({ error: modificationError });
      return;
    }
    if (nextPredecessor) {
      const predecessorError = await validatePredecessorLink(nextPredecessor, {
        id: calendarCurrent.id,
        fileId: calendarCurrent.fileId,
        startDate: data.startDate?.toISOString().slice(0, 10) ?? calendarCurrent.startDate,
        isCapitalLease: data.isCapitalLease ?? calendarCurrent.isCapitalLease,
        interestRate: data.interestRate ?? calendarCurrent.interestRate,
        monthlyPayment: data.monthlyPayment ?? calendarCurrent.monthlyPayment,
        termMonths: data.termMonths ?? calendarCurrent.termMonths,
      }, nextModificationDate!, nextAssessment);
      if (predecessorError) {
        res.status(400).json({ error: predecessorError });
        return;
      }
      const treatmentError = validateAccountingTreatmentForAgreementKind(
        nextAssessment,
        agreementKind({
          isCapitalLease: data.isCapitalLease ?? calendarCurrent.isCapitalLease,
          interestRate: data.interestRate ?? calendarCurrent.interestRate,
          monthlyPayment: data.monthlyPayment ?? calendarCurrent.monthlyPayment,
          termMonths: data.termMonths ?? calendarCurrent.termMonths,
        }),
      );
      if (treatmentError) {
        res.status(400).json({ error: treatmentError });
        return;
      }
    }
  }
  const rateTermsError = validateRateTerms({
    rateType: data.rateType ?? (calendarCurrent.rateType as "fixed" | "prime_linked"),
    rateBenchmark: data.rateBenchmark === undefined ? calendarCurrent.rateBenchmark : data.rateBenchmark,
    contractualPrimeName:
      data.contractualPrimeName === undefined
        ? calendarCurrent.contractualPrimeName
        : data.contractualPrimeName,
    benchmarkEquivalentToContractualPrime:
      data.benchmarkEquivalentToContractualPrime === undefined
        ? calendarCurrent.benchmarkEquivalentToContractualPrime
        : data.benchmarkEquivalentToContractualPrime,
    rateSpread:
      data.rateSpread === undefined
        ? calendarCurrent.rateSpread == null
          ? null
          : Number(calendarCurrent.rateSpread)
        : data.rateSpread,
    rateResetFrequency: data.rateResetFrequency ?? calendarCurrent.rateResetFrequency,
    rateEffectiveConvention:
      data.rateEffectiveConvention ?? calendarCurrent.rateEffectiveConvention,
    ratePaymentTreatment: data.ratePaymentTreatment ?? calendarCurrent.ratePaymentTreatment,
    initialFvRateAssumption:
      data.initialFvRateAssumption === undefined
        ? calendarCurrent.initialFvRateAssumption
        : data.initialFvRateAssumption,
  });
  if (data.rateBenchmark !== undefined && data.rateBenchmark !== null && data.rateBenchmark !== "boc_v80691311") {
    res.status(400).json({ error: "Future automatic sourcing requires explicit adoption of boc_v80691311" });
    return;
  }
  if (rateTermsError) {
    res.status(400).json({ error: rateTermsError });
    return;
  }
  const rateTermsChanged = [
    data.rateType, data.rateBenchmark, data.contractualPrimeName,
    data.benchmarkEquivalentToContractualPrime, data.rateSpread,
    data.rateResetFrequency, data.rateEffectiveConvention, data.ratePaymentTreatment,
  ].some((value) => value !== undefined);
  if (rateTermsChanged && calendarCurrent.rateType === "prime_linked") {
    const applied = await db.select({ id: loanEventsTable.id }).from(loanEventsTable).where(
      and(eq(loanEventsTable.loanId, params.data.id), eq(loanEventsTable.kind, "rate_reset")),
    ).limit(1);
    if (applied.length) {
      res.status(409).json({
        error: "Changing prime-linked contractual terms requires the modification assessment workflow.",
      });
      return;
    }
  }
  const nextFrequency = data.paymentFrequency ?? calendarCurrent.paymentFrequency;
  const suppliedNonNullDueDays =
    data.semiMonthlyFirstDueDay != null ||
    data.semiMonthlySecondDueDay != null;
  if (nextFrequency !== "semi-monthly" && suppliedNonNullDueDays) {
    res.status(400).json({
      error: "semi-monthly due days are only allowed with semi-monthly paymentFrequency",
    });
    return;
  }
  const calendarError = validatePaymentCalendar({
    paymentFrequency: nextFrequency,
    semiMonthlyFirstDueDay:
      nextFrequency === "semi-monthly"
        ? data.semiMonthlyFirstDueDay ?? calendarCurrent.semiMonthlyFirstDueDay
        : null,
    semiMonthlySecondDueDay:
      nextFrequency === "semi-monthly"
        ? data.semiMonthlySecondDueDay ?? calendarCurrent.semiMonthlySecondDueDay
        : null,
    startDate:
      data.startDate?.toISOString().split("T")[0] ?? calendarCurrent.startDate,
    firstPaymentDate:
      data.firstPaymentDate === undefined
        ? calendarCurrent.firstPaymentDate
        : data.firstPaymentDate?.toISOString().split("T")[0] ?? null,
    termYears: data.termYears ?? calendarCurrent.termYears,
    termMonths:
      data.termMonths === undefined
        ? calendarCurrent.termMonths
        : data.termMonths,
    graceMonths: data.graceMonths ?? calendarCurrent.graceMonths,
    graceTermMode: data.graceTermMode ?? calendarCurrent.graceTermMode,
    allowMissingSemiMonthlyDays: true,
  });
  if (calendarError) {
    res.status(400).json({ error: calendarError });
    return;
  }

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
  if (data.rateType != null) updates.rateType = data.rateType;
  if (data.rateBenchmark !== undefined) updates.rateBenchmark = data.rateBenchmark;
  if (data.contractualPrimeName !== undefined) updates.contractualPrimeName = data.contractualPrimeName;
  if (data.benchmarkEquivalentToContractualPrime !== undefined)
    updates.benchmarkEquivalentToContractualPrime = data.benchmarkEquivalentToContractualPrime;
  if (data.rateSpread !== undefined)
    updates.rateSpread = data.rateSpread != null ? data.rateSpread.toString() : null;
  if (data.rateResetFrequency !== undefined) updates.rateResetFrequency = data.rateResetFrequency;
  if (data.rateEffectiveConvention !== undefined)
    updates.rateEffectiveConvention = data.rateEffectiveConvention;
  if (data.ratePaymentTreatment !== undefined) updates.ratePaymentTreatment = data.ratePaymentTreatment;
  if (data.initialFvRateAssumption !== undefined)
    updates.initialFvRateAssumption = data.initialFvRateAssumption;
  if (data.amortizationYears != null) updates.amortizationYears = data.amortizationYears;
  if (data.termYears != null) updates.termYears = data.termYears;
  if (data.startDate != null) updates.startDate = data.startDate.toISOString().split("T")[0];
  if (data.paymentFrequency != null) updates.paymentFrequency = data.paymentFrequency;
  if (
    nextFrequency !== "semi-monthly" &&
    (calendarCurrent.semiMonthlyFirstDueDay != null ||
      calendarCurrent.semiMonthlySecondDueDay != null)
  ) {
    updates.semiMonthlyFirstDueDay = null;
    updates.semiMonthlySecondDueDay = null;
  }
  if (data.paymentTiming != null) updates.paymentTiming = data.paymentTiming;
  if (data.graceTermMode != null) updates.graceTermMode = data.graceTermMode;
  if (data.firstPaymentDate !== undefined)
    updates.firstPaymentDate =
      data.firstPaymentDate != null
        ? data.firstPaymentDate.toISOString().split("T")[0]
        : null;
  if (data.semiMonthlyFirstDueDay !== undefined)
    updates.semiMonthlyFirstDueDay = data.semiMonthlyFirstDueDay;
  if (data.semiMonthlySecondDueDay !== undefined)
    updates.semiMonthlySecondDueDay = data.semiMonthlySecondDueDay;
  if (data.ioMonths != null) updates.ioMonths = data.ioMonths;
  if (data.specificIoMonths != null) updates.specificIoMonths = data.specificIoMonths;
  if (data.graceMonths != null) updates.graceMonths = data.graceMonths;
  if (data.graceInterestTreatment != null) updates.graceInterestTreatment = data.graceInterestTreatment;
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
  if (data.masterAgreementId !== undefined) {
    if (data.masterAgreementId != null) {
      const [current] = await db
        .select({ fileId: loansTable.fileId, securityClauses: loansTable.securityClauses })
        .from(loansTable)
        .where(and(eq(loansTable.id, params.data.id), isNull(loansTable.deletedAt)));
      if (!current) {
        res.status(404).json({ error: "Loan not found" });
        return;
      }
      const link = await validateMasterLink(data.masterAgreementId, current.fileId);
      if (link.error) {
        res.status(400).json({ error: link.error });
        return;
      }
      // Copy-on-link: persist the master's security wording onto the facility
      // when neither the request nor the stored loan carries its own wording,
      // so the disclosure survives a later master deletion/unlink.
      const inherited = resolveInheritedSecurityClauses(
        data.securityClauses,
        current.securityClauses as string[] | null,
        link.securityDescription,
      );
      if (inherited) updates.securityClauses = inherited;
    }
    // Explicit null unlinks the facility (back to a standalone loan).
    updates.masterAgreementId = data.masterAgreementId;
  }
  if (data.predecessorAgreementId !== undefined)
    updates.predecessorAgreementId = data.predecessorAgreementId;
  if (data.modificationEffectiveDate !== undefined)
    updates.modificationEffectiveDate =
      data.modificationEffectiveDate?.toISOString().slice(0, 10) ?? null;
  if (data.modificationAssessment !== undefined)
    updates.modificationAssessment = nextAssessment;

  const scheduleChanged = Object.keys(updates).some((field) =>
    SCHEDULE_DRIVING_FIELDS.has(field as keyof typeof loansTable.$inferSelect),
  );
  const loan = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(loansTable)
      .set(updates)
      .where(and(eq(loansTable.id, params.data.id), isNull(loansTable.deletedAt)))
      .returning();
    if (!updated || !scheduleChanged) return updated;

    const [latest] = await tx
      .select({ revisionNumber: loanContractRevisionsTable.revisionNumber })
      .from(loanContractRevisionsTable)
      .where(eq(loanContractRevisionsTable.loanId, updated.id))
      .orderBy(desc(loanContractRevisionsTable.revisionNumber))
      .limit(1);
    return appendContractRevision(
      tx,
      updated,
      (latest?.revisionNumber ?? 0) + 1,
      data.changeReason?.trim() || (latest ? "Schedule-driving terms updated" : "Legacy baseline"),
    );
  });

  if (!loan) {
    res.status(404).json({ error: "Loan not found" });
    return;
  }

  const activeEvents = await loadActiveEvents([loan]);
  res.json(cleanLoan(loan, activeEvents.get(loan.id)?.principal, activeEvents.get(loan.id)?.rates));
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
    const [file] = await db.select({ clientId: filesTable.clientId }).from(filesTable).where(eq(filesTable.id, loan.fileId));
    const buffer = file ? await retrieveDocument(settings, loan.sourceDocumentBlob, {
      tenantId: req.auth!.tenantId, firmId: req.auth!.firmId, clientId: file.clientId, fileId: loan.fileId,
    }) : null;
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

  // Preserve the master agreement grouping across roll-forward: reuse the
  // target file's copy of this master (matched by roll-forward lineage or by
  // identity when rolling within the same file), cloning it if none exists.
  let newMasterId: string | null = null;
  if (original.masterAgreementId) {
    const [sourceMaster] = await db
      .select()
      .from(masterAgreementsTable)
      .where(
        and(
          eq(masterAgreementsTable.id, original.masterAgreementId),
          isNull(masterAgreementsTable.deletedAt),
        ),
      );
    if (sourceMaster) {
      if (sourceMaster.fileId === parsed.data.fileId) {
        newMasterId = sourceMaster.id;
      } else {
        const targetMasters = await db
          .select()
          .from(masterAgreementsTable)
          .where(
            and(
              eq(masterAgreementsTable.fileId, parsed.data.fileId),
              isNull(masterAgreementsTable.deletedAt),
            ),
          );
        const existing = targetMasters.find((m) => m.rolledFromId === sourceMaster.id);
        if (existing) {
          newMasterId = existing.id;
        } else {
          const { id, createdAt, updatedAt, ...rest } = sourceMaster;
          const [cloned] = await db
            .insert(masterAgreementsTable)
            .values({
              ...rest,
              fileId: parsed.data.fileId,
              rolledFromId: sourceMaster.id,
              sourceDocumentBlob: null,
              sourceDocumentName: null,
            })
            .returning();
          newMasterId = cloned.id;
        }
      }
    }
  }

  const data = {
    fileId: parsed.data.fileId,
    name: original.name,
    masterAgreementId: newMasterId,
    description: original.description,
    counterparty: original.counterparty,
    isCapitalLease: original.isCapitalLease,
    principal: original.principal,
    downPayment: original.downPayment,
    interestRate: original.interestRate,
    rateType: original.rateType,
    rateBenchmark: original.rateBenchmark,
    contractualPrimeName: original.contractualPrimeName,
    benchmarkEquivalentToContractualPrime: original.benchmarkEquivalentToContractualPrime,
    rateSpread: original.rateSpread,
    rateResetFrequency: original.rateResetFrequency,
    rateEffectiveConvention: original.rateEffectiveConvention,
    ratePaymentTreatment: original.ratePaymentTreatment,
    initialFvRateAssumption: original.initialFvRateAssumption,
    amortizationYears: original.amortizationYears,
    termYears: original.termYears,
    startDate: original.startDate,
    fiscalYearEnd: parsed.data.newFiscalYearEnd.toISOString().split("T")[0],
    paymentFrequency: original.paymentFrequency,
    paymentTiming: original.paymentTiming,
    graceTermMode: original.graceTermMode,
    firstPaymentDate: original.firstPaymentDate,
    semiMonthlyFirstDueDay: original.semiMonthlyFirstDueDay,
    semiMonthlySecondDueDay: original.semiMonthlySecondDueDay,
    ioMonths: original.ioMonths,
    specificIoMonths: original.specificIoMonths,
    graceMonths: original.graceMonths,
    graceInterestTreatment: original.graceInterestTreatment,
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
    monthlyPayment: original.monthlyPayment,
    paymentOverride: original.paymentOverride,
    termMonths: original.termMonths,
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
    // Document handles are bound to their original Year-End File.
    sourceDocumentBlob: null,
    sourceDocumentName: null,
    fvRate: original.fvRate,
    fvDecision: original.fvDecision,
    fvDecisionNote: original.fvDecisionNote,
    predecessorAgreementId: original.predecessorAgreementId,
    modificationEffectiveDate: original.modificationEffectiveDate,
    modificationAssessment: original.modificationAssessment,
  };

  const loan = await db.transaction(async (tx) => {
    const [created] = await tx.insert(loansTable).values(data).returning();
    const projected = await appendContractRevision(
      tx,
      created,
      1,
      "Rolled forward from prior fiscal year",
    );
    await cloneActiveLoanEvents(tx, original.id, projected.id, projected.currentRevisionId!);
    const [withEvents] = await tx
      .select()
      .from(loansTable)
      .where(eq(loansTable.id, projected.id));
    return withEvents;
  });
  const activeEvents = await loadActiveEvents([loan]);
  res.status(201).json(cleanLoan(loan, activeEvents.get(loan.id)?.principal, activeEvents.get(loan.id)?.rates));
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

router.get("/counterparties", async (req, res): Promise<void> => {
  const rows = await db
    .selectDistinct({ counterparty: loansTable.counterparty })
    .from(loansTable)
    .innerJoin(filesTable, eq(loansTable.fileId, filesTable.id))
    .innerJoin(clientsTable, eq(filesTable.clientId, clientsTable.id))
    .innerJoin(clientMembershipsTable, and(eq(clientMembershipsTable.clientId, clientsTable.id), eq(clientMembershipsTable.tenantId, req.auth!.tenantId), eq(clientMembershipsTable.objectId, req.auth!.objectId)))
    .where(and(isNotNull(loansTable.counterparty), isNull(loansTable.deletedAt), eq(clientsTable.firmId, req.auth!.firmId), isNull(clientsTable.quarantinedAt), isNotNull(clientsTable.adoptedAt)));

  const names = rows
    .map((r) => r.counterparty)
    .filter((c): c is string => !!c && c.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));

  res.json(names);
});

export default router;
