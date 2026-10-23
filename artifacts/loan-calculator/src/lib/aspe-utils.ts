import { isAfter, addMonths, subDays, parseISO, format } from "date-fns";
import { calculateAmortization, calculateFairValueSchedule, calculateProspectiveModificationSchedule, isValidFvRate, type AmortizationRow, type Frequency, type PrincipalPaymentEvent, type RateResetEvent } from "@workspace/amortization";
import { calculateStraightLineLease, buildYearlyStraightLine } from "./straight-line";
import { getFiscalYear, getFyEndParts } from "./fiscal";

export interface BookedScheduleInput {
  principal: number | string;
  downPayment?: number | string | null;
  interestRate: number | string;
  amortizationYears: number;
  termYears: number;
  startDate: string;
  ioMonths?: number | null;
  specificIoMonths?: string | null;
  balloonPayment?: number | string | null;
  paymentFrequency?: string | null;
  paymentTiming?: "beginning" | "end" | null;
  graceTermMode?: "included" | "added" | null;
  firstPaymentDate?: string | null;
  semiMonthlyFirstDueDay?: number | null;
  semiMonthlySecondDueDay?: number | null;
  fvDecision?: string | null;
  fvRate?: number | string | null;
  paymentOverride?: number | string | null;
  /** Contractual first installment when it differs from the regular payment. */
  firstPaymentAmount?: number | string | null;
  graceMonths?: number | null;
  graceInterestTreatment?: string | null;
  rateType?: "fixed" | "prime_linked" | string | null;
  rateBenchmark?: string | null;
  contractualPrimeName?: string | null;
  rateSpread?: number | string | null;
  ratePaymentTreatment?: "keep_payment" | "keep_maturity" | string | null;
  /**
   * Immutable rate-reset evidence from GET /rate-timeline.  It is deliberately
   * separate from principal events: a rate event does not become a payment.
   */
  rateTimelineEvents?: RateTimelineEvent[] | null;
  /** Alias used by callers that have already selected the active timeline. */
  activeRateEvents?: readonly unknown[] | null;
  activeRateSetId?: string | null;
  /** Frozen recognition-date assumptions; never substitute realized resets here. */
  initialFvRateAssumption?: Record<string, unknown> | null;
  /** Immutable, canonically ordered events returned with the active set. */
  activeEvents?: Array<{
    kind?: string;
    id: string;
    effectiveDate: string;
    ordering: "before_scheduled_payment" | "after_scheduled_payment";
    sequence: number;
    amount: number | string | null;
    treatment: "keep_payment" | "keep_maturity";
  }> | null;
  currentRevisionId?: string | null;
  currentRevisionHash?: string | null;
  calculationVersion?: string | null;
  activeEventSetId?: string | null;
  activeEventSetVersion?: number | null;
  activeEventSetHash?: string | null;
  isCapitalLease?: boolean | null;
  monthlyPayment?: number | string | null;
  termMonths?: number | null;
  freeRentMonths?: number | null;
  rentEscalationRate?: number | string | null;
  rentSteps?: Array<{ fromYear: number; toYear: number; monthlyRent: number }> | null;
  tenantImprovementAllowance?: number | string | null;
  otherInducements?: number | string | null;
  /** Explicit predecessor supplied by file/reporting callers for transition-aware output. */
  predecessorAgreement?: BookedScheduleInput | null;
  predecessorAgreementId?: string | null;
  modificationEffectiveDate?: string | null;
  modificationAssessment?: AgreementModificationAssessment | null;
}

export interface FairValueDecisionConfirmation {
  id: string;
  version: number;
  treatment: "use_fv" | "trivial" | "immaterial" | string;
  marketEffectiveRate?: string | number | null;
  rationaleNote?: string | null;
  confirmedAt: string | Date;
  confirmedBy: string;
  canonicalFingerprint: string;
  contractFingerprint: string;
  eventSetFingerprint?: string | null;
  reportingContextFingerprint: string;
  modificationFingerprint?: string | null;
  evidenceVersion: string;
  calculationVersion: string;
  evidence: Record<string, unknown>;
}

export interface FairValueDecisionHistory {
  status: string;
  reviewRequired: boolean;
  staleReasons: string[];
  missingRequirements: string[];
  current?: FairValueDecisionConfirmation | null;
  history: FairValueDecisionConfirmation[];
}

/** Persisted API shape. Keep this deliberately aligned with the generated contract. */
export interface AgreementModificationAssessment {
  status: "confirmed";
  assessmentDate: string;
  confirmedAt: string;
  confirmedBy: string;
  evidence: {
    changeSummary: string;
    contractualChanges: Array<{
      term: string;
      predecessorValue: string;
      successorValue: string;
      significance: string;
      sourceReference: string;
    }>;
    qualitativeFactors: string[];
    facts: {
      creditorChanged: boolean;
      creditorChangedEvidence?: string;
      legalDischarge: boolean;
      legalDischargeEvidence?: string;
      relatedParty: boolean;
      relatedPartyEvidence?: string;
    };
    quantitativeTest?: {
      method: string;
      originalEffectiveRate: number;
      carryingAmount: number;
      originalRemainingCashFlows: Array<{ date: string; amount: number; description: string; sourceReference: string }>;
      modifiedCashFlows: Array<{ date: string; amount: number; description: string; sourceReference: string }>;
      sameDayPaymentTreatment: "include" | "exclude";
      creditorFees: number;
      otherTransactionCosts: number;
      accruedInterest: number;
      accruedInterestTreatment: "included_in_carrying_amount" | "include_in_cash_flows" | "add_to_carrying_amount" | "exclude";
      predecessorAmount?: number;
      successorAmount?: number;
      presentValueOfOriginalRemainingCashFlows?: number;
      presentValueOfModifiedCashFlows?: number;
      differenceAmount: number;
      differencePercent: number;
      retainedFeesAndCosts: number;
      newFeesAndCosts: number;
      settlementConsideration?: number;
      recommendation: "derecognize_original" | "account_as_modification";
    } | null;
  };
  conclusion: {
    agreementChangeType: "renewal" | "modification";
    /** `new_lease` is an ASPE 3065 lease transition, not debt modification accounting. */
    accountingTreatment: "continuation" | "extinguishment" | "new_lease";
    rationale: string;
    leaseTransition?: {
      predecessorLeaseType: "operating" | "capital";
      originalLeaseTerminated: boolean;
      replacementLeaseExecuted: boolean;
      terminationEvidenceReference: string;
      entryDate: string;
      debitAccount: string;
      creditAccount: string;
      amount: number;
      entryEvidenceReference: string;
      predecessorDeferredRentAsset: number | null;
      predecessorDeferredRentLiability: number | null;
      predecessorAssetCost: number | null;
      predecessorAccumulatedDepreciation: number | null;
      successorInitialAmount: number;
    };
  };
}

export interface RateTimelineEvent {
  id: string;
  setId?: string | null;
  effectiveDate: string;
  ordering?: "before_scheduled_payment" | "after_scheduled_payment";
  sequence?: number;
  observationDate?: string | null;
  publishedDate?: string | null;
  fetchedAt?: string | null;
  benchmarkRate: number | string;
  spread: number | string;
  resultingRate?: number | string | null;
  resultingContractualRate?: number | string | null;
  benchmark?: string | null;
  source?: string | null;
  sourceSeries?: string | null;
  sourceUrl?: string | null;
  rateOrigin?: "automatic" | "override" | "restore" | string | null;
  treatment?: "keep_payment" | "keep_maturity" | string | null;
  reason?: string | null;
  author?: string | null;
  authoredAt?: string | null;
}

/** Maps API event evidence into the engine's intentionally smaller contract. */
export function toPrincipalPaymentEvents(loan: Pick<BookedScheduleInput, "activeEvents">): PrincipalPaymentEvent[] {
  return (loan.activeEvents ?? [])
    .filter((event) => event.kind == null || event.kind === "principal_prepayment")
    .filter((event) => event.amount != null && Number.isFinite(Number(event.amount)))
    .map((event) => ({
      id: event.id, effectiveDate: parseISO(event.effectiveDate), ordering: event.ordering,
      sequence: event.sequence, amount: Number(event.amount), treatment: event.treatment,
    }));
}

const dateOrUndefined = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/** Convert persisted timeline evidence to the engine's dated-rate contract. */
export function toRateResetEvents(loan: Pick<BookedScheduleInput, "rateTimelineEvents" | "activeRateEvents" | "activeRateSetId" | "ratePaymentTreatment">): RateResetEvent[] {
  const rawEvents = (loan.activeRateEvents ?? loan.rateTimelineEvents ?? []) as RateTimelineEvent[];
  return rawEvents
    .filter((event) => (event as RateTimelineEvent & { kind?: string }).kind == null || (event as RateTimelineEvent & { kind?: string }).kind === "rate_reset")
    .filter((event) => !loan.activeRateSetId || !event.setId || event.setId === loan.activeRateSetId)
    .map((event, index): RateResetEvent | null => {
      const effectiveDate = dateOrUndefined(event.effectiveDate);
      const benchmarkRate = Number(event.benchmarkRate);
      const spread = Number(event.spread);
      const resultingContractualRate = Number(event.resultingContractualRate ?? event.resultingRate ?? benchmarkRate + spread);
      if (!effectiveDate || !Number.isFinite(benchmarkRate) || !Number.isFinite(spread) || !Number.isFinite(resultingContractualRate)) return null;
      const override = event.rateOrigin === "override";
      const authoredAt = dateOrUndefined(event.authoredAt);
      return {
        id: event.id,
        effectiveDate,
        ordering: event.ordering === "after_scheduled_payment" ? "after_scheduled_payment" : "before_scheduled_payment",
        sequence: Number.isSafeInteger(event.sequence) ? event.sequence! : index,
        benchmarkRate,
        spread,
        resultingContractualRate,
        sourceEvidence: {
          source: event.sourceSeries ?? event.source ?? event.benchmark ?? "documented rate evidence",
          observationDate: dateOrUndefined(event.observationDate),
          publishedDate: dateOrUndefined(event.publishedDate),
          fetchedAt: dateOrUndefined(event.fetchedAt),
          reference: event.sourceUrl ?? undefined,
        },
        overrideEvidence: override && event.reason && authoredAt
          ? { reason: event.reason, authoredAt, author: event.author ?? undefined, reference: event.sourceUrl ?? undefined }
          : undefined,
        treatment: event.treatment === "keep_maturity" || loan.ratePaymentTreatment === "keep_maturity" ? "keep_maturity" : "keep_payment",
      };
    })
    .filter((event): event is RateResetEvent => event !== null);
}

/** Day-one assumptions are a separately frozen timeline, not live rate evidence. */
export function toFrozenFvRateResetEvents(loan: Pick<BookedScheduleInput, "initialFvRateAssumption" | "ratePaymentTreatment">): RateResetEvent[] {
  const assumption = loan.initialFvRateAssumption;
  if (!assumption) return [];
  const events = Array.isArray(assumption.events) ? assumption.events : Array.isArray(assumption.rateResetEvents) ? assumption.rateResetEvents : [];
  return toRateResetEvents({ activeRateEvents: events as RateTimelineEvent[], ratePaymentTreatment: loan.ratePaymentTreatment });
}

/** Evidence travels with calculations, including when fair value is applied. */
export function loanCalculationEvidence(loan: Pick<BookedScheduleInput, "currentRevisionId" | "currentRevisionHash" | "calculationVersion" | "activeEventSetId" | "activeEventSetVersion" | "activeEventSetHash" | "activeEvents" | "activeRateSetId" | "rateTimelineEvents" | "activeRateEvents">) {
  return {
    currentRevisionId: loan.currentRevisionId ?? null,
    currentRevisionHash: loan.currentRevisionHash ?? null,
    calculationVersion: loan.calculationVersion ?? null,
    activeEventSetId: loan.activeEventSetId ?? null,
    activeEventSetVersion: loan.activeEventSetVersion ?? null,
    activeEventSetHash: loan.activeEventSetHash ?? null,
    activeEventCount: loan.activeEvents?.length ?? 0,
    activeRateSetId: loan.activeRateSetId ?? null,
    activeRateEventCount: ((loan.activeRateEvents ?? loan.rateTimelineEvents ?? []) as RateTimelineEvent[]).filter(
      (event) => !loan.activeRateSetId || !event.setId || event.setId === loan.activeRateSetId,
    ).length,
  };
}

/**
 * Recognition-date evidence intentionally excludes the live contractual rate
 * timeline. Prime observations after recognition are subsequent-measurement
 * evidence and must never make a day-one measurement appear to have changed.
 */
export function dayOneFairValueCalculationEvidence(
  loan: Pick<BookedScheduleInput, "currentRevisionId" | "currentRevisionHash" | "calculationVersion" | "activeEventSetId" | "activeEventSetVersion" | "activeEventSetHash" | "activeEvents" | "initialFvRateAssumption" | "rateType">,
) {
  const assumption = loan.initialFvRateAssumption ?? null;
  const frozenEvents = assumption && (
    Array.isArray(assumption.events) ? assumption.events
      : Array.isArray(assumption.rateResetEvents) ? assumption.rateResetEvents
        : []
  );
  return {
    currentRevisionId: loan.currentRevisionId ?? null,
    currentRevisionHash: loan.currentRevisionHash ?? null,
    calculationVersion: loan.calculationVersion ?? null,
    activeEventSetId: loan.activeEventSetId ?? null,
    activeEventSetVersion: loan.activeEventSetVersion ?? null,
    activeEventSetHash: loan.activeEventSetHash ?? null,
    activeEventCount: loan.activeEvents?.length ?? 0,
    rateType: loan.rateType ?? "fixed",
    recognitionDateRateAssumption: assumption,
    frozenRateEventCount: frozenEvents?.length ?? 0,
    fvAssumptionFrozen: loan.rateType !== "prime_linked" || assumption != null,
  };
}

/**
 * Returns the booked amortization schedule for a loan/lease. When fair value is
 * adopted (`fvDecision === "use_fv"`), the contractual cash payments are held
 * fixed and the principal/interest split is derived with the effective-interest
 * method at the fair-value rate (see `calculateFairValueSchedule`). Otherwise the
 * contractual schedule is returned. This is the single source of truth so every
 * view (loan detail, file cards, reports) reports identical figures.
 */
function calculateStandaloneBookedSchedule(loan: BookedScheduleInput): {
  monthlyPayment: number;
  totalInterest: number;
  totalPayment: number;
  schedule: AmortizationRow[];
  fairValue: number | null;
  usedFairValue: boolean;
  evidenceMetadata?: Record<string, unknown>;
} {
  const frequency = (loan.paymentFrequency ?? "monthly") as Frequency;
  const contractual = calculateAmortization(
    Number(loan.principal) - Number(loan.downPayment ?? 0),
    Number(loan.interestRate),
    loan.amortizationYears,
    loan.termYears,
    parseISO(loan.startDate),
    loan.ioMonths ?? 0,
    loan.specificIoMonths ? loan.specificIoMonths.split(",").map(Number).filter((n) => !isNaN(n)) : [],
    Number(loan.balloonPayment ?? 0),
    frequency,
    loan.paymentOverride != null ? Number(loan.paymentOverride) : null,
    loan.graceMonths ?? 0,
    loan.graceInterestTreatment === "none" ? "none" : "capitalized",
    {
      paymentTiming: loan.paymentTiming ?? "end",
      graceTermMode: loan.graceTermMode ?? "included",
      firstPaymentDate: loan.firstPaymentDate ? parseISO(loan.firstPaymentDate) : undefined,
      firstPaymentAmount: loan.firstPaymentAmount != null ? Number(loan.firstPaymentAmount) : null,
      semiMonthlyDueDays:
        loan.semiMonthlyFirstDueDay != null && loan.semiMonthlySecondDueDay != null
          ? [loan.semiMonthlyFirstDueDay, loan.semiMonthlySecondDueDay]
          : undefined,
      principalEvents: toPrincipalPaymentEvents(loan),
      rateResetEvents: toRateResetEvents(loan),
      evidenceMetadata: loanCalculationEvidence(loan),
    },
  );
  const fvRate = loan.fvRate != null ? Number(loan.fvRate) : 0;
  // A malformed persisted rate (0, negative, NaN, Infinity) must never drive
  // the effective-interest math — fall back to the contractual schedule.
  if (loan.fvDecision === "use_fv" && isValidFvRate(fvRate)) {
    // Fair value is a recognition-date measurement. Rebuild its contractual
    // cash-flow input from the approved frozen assumption timeline, rather than
    // allowing later realized benchmark resets to revise day-one evidence.
    const frozenRateEvents = toFrozenFvRateResetEvents(loan);
    const dayOneEvidence = dayOneFairValueCalculationEvidence(loan);
    const fvContractual = loan.rateType === "prime_linked"
      ? calculateAmortization(
          Number(loan.principal) - Number(loan.downPayment ?? 0), Number(loan.interestRate),
          loan.amortizationYears, loan.termYears, parseISO(loan.startDate), loan.ioMonths ?? 0,
          loan.specificIoMonths ? loan.specificIoMonths.split(",").map(Number).filter((n) => !isNaN(n)) : [],
          Number(loan.balloonPayment ?? 0), frequency, loan.paymentOverride != null ? Number(loan.paymentOverride) : null,
          loan.graceMonths ?? 0, loan.graceInterestTreatment === "none" ? "none" : "capitalized",
          { paymentTiming: loan.paymentTiming ?? "end", graceTermMode: loan.graceTermMode ?? "included",
            firstPaymentDate: loan.firstPaymentDate ? parseISO(loan.firstPaymentDate) : undefined,
            firstPaymentAmount: loan.firstPaymentAmount != null ? Number(loan.firstPaymentAmount) : null,
            semiMonthlyDueDays: loan.semiMonthlyFirstDueDay != null && loan.semiMonthlySecondDueDay != null ? [loan.semiMonthlyFirstDueDay, loan.semiMonthlySecondDueDay] : undefined,
            principalEvents: toPrincipalPaymentEvents(loan), rateResetEvents: frozenRateEvents,
            evidenceMetadata: dayOneEvidence, },
        )
      : contractual;
    const fv = calculateFairValueSchedule(fvContractual.schedule, fvRate, frequency, {
      paymentTiming: loan.paymentTiming ?? "end",
      evidenceMetadata: dayOneEvidence,
      commencementDate: parseISO(loan.startDate),
    });
    return {
      monthlyPayment: fv.monthlyPayment,
      totalInterest: fv.totalInterest,
      totalPayment: fv.totalPayment,
      schedule: fv.schedule,
      fairValue: fv.fairValue,
      usedFairValue: true,
      evidenceMetadata: fv.evidenceMetadata,
    };
  }
  return {
    monthlyPayment: contractual.monthlyPayment,
    totalInterest: contractual.totalInterest,
    totalPayment: contractual.totalPayment,
    schedule: contractual.schedule,
    fairValue: null,
    usedFairValue: false,
    evidenceMetadata: contractual.evidenceMetadata,
  };
}

export type BookedScheduleResult = ReturnType<typeof calculateStandaloneBookedSchedule>;

export const PROSPECTIVE_EIR_EVIDENCE_WARNING =
  "Prospective effective-interest schedule could not be produced from persisted transition evidence. Correct and reconfirm the modification assessment.";

/**
 * The reporting schedule for a linked agreement. The old agreement owns all
 * rows through the effective date and the new agreement owns rows after it.
 * This explicit cut-over prevents the two complete contracts being added
 * together in annual reports.
 */
export function calculateBookedSchedule(loan: BookedScheduleInput): BookedScheduleResult {
  const successor = calculateStandaloneBookedSchedule(loan);
  const predecessor = loan.predecessorAgreement;
  const effective = dateOrUndefined(loan.modificationEffectiveDate);
  if (!predecessor || !effective || loan.modificationAssessment?.status !== "confirmed") {
    return successor;
  }
  if (isOperatingLeaseLoan({
    isCapitalLease: !!(predecessor as BookedScheduleInput & { isCapitalLease?: boolean | null }).isCapitalLease,
    interestRate: predecessor.interestRate,
    monthlyPayment: (predecessor as BookedScheduleInput & { monthlyPayment?: number | string | null }).monthlyPayment,
    termMonths: (predecessor as BookedScheduleInput & { termMonths?: number | null }).termMonths,
  })) {
    // Operating leases have no liability amortization schedule to splice.
    return successor;
  }

  const prior = calculateStandaloneBookedSchedule(predecessor);
  const quantitative = loan.modificationAssessment.evidence.quantitativeTest;
  const successorOwnsEffectiveDate =
    loan.modificationAssessment.conclusion.accountingTreatment !== "new_lease" &&
    quantitative?.sameDayPaymentTreatment === "include";
  const predecessorRows = prior.schedule.filter((row) =>
    successorOwnsEffectiveDate
      ? row.date.getTime() < effective.getTime()
      : row.date.getTime() <= effective.getTime(),
  );
  let prospective: ReturnType<typeof calculateProspectiveModificationSchedule> | null = null;
  let prospectiveEirWarning: string | null = null;
  if (loan.modificationAssessment.conclusion.accountingTreatment === "continuation") {
    try {
      // Legacy persisted assessments can predate the structured evidence rules.
      // Reporting must remain available, while new/edited saves are rejected by
      // the API/UI until this evidence is corrected.
      if (!quantitative || !Array.isArray(quantitative.modifiedCashFlows) || quantitative.modifiedCashFlows.length === 0) {
        throw new Error("Missing modified dated cash flows");
      }
      prospective = calculateProspectiveModificationSchedule({
        effectiveDate: effective,
        openingCarryingAmount: quantitative.carryingAmount,
        retainedFeesAndCosts: quantitative.retainedFeesAndCosts,
        newFeesAndCosts: quantitative.newFeesAndCosts,
        modifiedCashFlows: quantitative.modifiedCashFlows.map((flow) => ({
          date: parseISO(flow.date),
          amount: flow.amount,
          description: flow.description,
          sourceReference: flow.sourceReference,
        })),
        sameDayPaymentTreatment: quantitative.sameDayPaymentTreatment,
      });
    } catch {
      prospectiveEirWarning = PROSPECTIVE_EIR_EVIDENCE_WARNING;
    }
  }
  const schedule = [
    ...predecessorRows,
    ...(prospective?.schedule ?? successor.schedule).filter((row) =>
      successorOwnsEffectiveDate
        ? row.date.getTime() >= effective.getTime()
        : row.date.getTime() > effective.getTime(),
    ),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  const totalInterest = schedule.reduce((sum, row) => sum + row.interest, 0);
  const totalPayment = schedule.reduce((sum, row) => sum + row.payment, 0);
  return {
    ...successor,
    schedule,
    totalInterest,
    totalPayment,
    evidenceMetadata: {
      ...(successor.evidenceMetadata ?? {}),
      transition: {
        predecessorAgreementId: loan.predecessorAgreementId ?? null,
        effectiveDate: loan.modificationEffectiveDate,
        accountingTreatment: loan.modificationAssessment.conclusion.accountingTreatment,
        predecessorRowsThroughEffectiveDate: predecessorRows.length,
        successorRowsAfterEffectiveDate: (prospective?.schedule ?? successor.schedule).filter((row) =>
          successorOwnsEffectiveDate ? row.date.getTime() >= effective.getTime() : row.date.getTime() > effective.getTime(),
        ).length,
        effectiveDateOwner: successorOwnsEffectiveDate ? "successor" : "predecessor",
        prospectiveEffectiveInterestBasis: prospective?.effectiveInterestBasis ?? null,
        prospectiveEffectiveAnnualRate: prospective?.resultingEffectiveAnnualRate ?? null,
        prospectiveEirWarning,
        prospectiveEirFallback: prospectiveEirWarning ? "date_cut_standalone_successor" : null,
        assessmentCorrectionRequired: !!prospectiveEirWarning,
      },
    },
  };
}

export interface TransitionJournalLine {
  account: string;
  debit: number;
  credit: number;
}

export interface TransitionJournalEntry {
  date: string;
  kind:
    | "debt_modification"
    | "debt_extinguishment"
    | "debt_recognition"
    | "operating_lease_termination"
    | "capital_lease_derecognition"
    | "lease_commencement"
    | "operating_lease_commencement";
  memo: string;
  lines: TransitionJournalLine[];
}

export interface TransitionJournalInput {
  effectiveDate: string;
  assessment: AgreementModificationAssessment;
  predecessorKind: "loan" | "capital_lease" | "operating_lease";
  successorKind: "loan" | "capital_lease" | "operating_lease";
  predecessorCarryingAmount: number;
  successorInitialAmount: number;
  /** Existing unamortized fees/costs retained in a continuation. */
  retainedFeesAndCosts?: number;
  /** Incremental fees/costs paid for the changed agreement. */
  newFeesAndCosts?: number;
  operatingDeferredRentAsset?: number;
  operatingDeferredRentLiability?: number;
  capitalLeaseAssetCost?: number;
  capitalLeaseAccumulatedDepreciation?: number;
}

const journalLine = (account: string, debit = 0, credit = 0): TransitionJournalLine => ({
  account,
  debit: Math.max(0, debit),
  credit: Math.max(0, credit),
});

/**
 * Builds transition-only entries. Routine cash payments and interest remain in
 * the normal annual entry helpers, so they are not duplicated here.
 */
export function buildTransitionJournalEntries(input: TransitionJournalInput): TransitionJournalEntry[] {
  const entries: TransitionJournalEntry[] = [];
  const quantitative = input.assessment.evidence.quantitativeTest;
  const leaseTransition = input.assessment.conclusion.leaseTransition;
  const retained = Math.max(0, quantitative?.retainedFeesAndCosts ?? input.retainedFeesAndCosts ?? 0);
  const newCosts = Math.max(0, quantitative?.newFeesAndCosts ?? input.newFeesAndCosts ?? 0);
  const oldAmount = Math.max(0, quantitative?.carryingAmount ?? input.predecessorCarryingAmount);
  const newAmount = Math.max(0, leaseTransition?.successorInitialAmount ?? quantitative?.successorAmount ?? input.successorInitialAmount);
  const treatment = input.assessment.conclusion.accountingTreatment;
  const isNewLease = treatment === "new_lease";

  // ASPE 3065 new-lease accounting is intentionally handled before debt
  // branches. A persisted `new_lease` conclusion must never be treated as a
  // debt continuation or extinguishment, even if malformed source data links
  // it to a loan predecessor.
  if (input.predecessorKind === "operating_lease") {
    const asset = Math.max(0, leaseTransition?.predecessorDeferredRentAsset ?? input.operatingDeferredRentAsset ?? 0);
    const liability = Math.max(0, leaseTransition?.predecessorDeferredRentLiability ?? input.operatingDeferredRentLiability ?? 0);
    const netGain = Math.max(0, liability - asset);
    const netLoss = Math.max(0, asset - liability);
    entries.push({
      date: input.effectiveDate,
      kind: "operating_lease_termination",
      memo: "Terminate predecessor operating lease and clear deferred rent balances",
      lines: [
        journalLine("Deferred rent liability", liability),
        journalLine("Loss on lease termination", netLoss),
        journalLine("Deferred rent asset", 0, asset),
        journalLine("Gain on lease termination", 0, netGain),
      ].filter((line) => line.debit > 0 || line.credit > 0),
    });
  } else if (input.predecessorKind === "capital_lease") {
    const cost = Math.max(0, leaseTransition?.predecessorAssetCost ?? input.capitalLeaseAssetCost ?? 0);
    const accumulated = Math.max(0, leaseTransition?.predecessorAccumulatedDepreciation ?? input.capitalLeaseAccumulatedDepreciation ?? 0);
    const assetNbv = Math.max(0, cost - accumulated);
    const gain = Math.max(0, oldAmount - assetNbv);
    const loss = Math.max(0, assetNbv - oldAmount);
    entries.push({
      date: input.effectiveDate,
      kind: "capital_lease_derecognition",
      memo: "Derecognize predecessor capital lease",
      lines: [
        journalLine("Capital lease obligation", oldAmount),
        journalLine("Accumulated depreciation — leased asset", accumulated),
        journalLine("Loss on lease derecognition", loss),
        journalLine("Leased asset", 0, cost),
        journalLine("Gain on lease derecognition", 0, gain),
      ].filter((line) => line.debit > 0 || line.credit > 0),
    });
  } else if (!isNewLease && treatment === "extinguishment") {
    if (quantitative?.settlementConsideration == null || !Number.isFinite(quantitative.settlementConsideration)) {
      throw new Error("Confirmed extinguishment requires persisted quantitativeTest.settlementConsideration");
    }
    const settlement = Math.max(0, quantitative.settlementConsideration);
    const gain = Math.max(0, oldAmount - settlement);
    const loss = Math.max(0, settlement - oldAmount);
    entries.push({
      date: input.effectiveDate,
      kind: "debt_extinguishment",
      memo: "Derecognize predecessor debt; present extinguishment gain or loss separately",
      lines: [
        journalLine("Predecessor debt", oldAmount),
        journalLine("Loss on debt extinguishment", loss),
        journalLine("Cash / settlement consideration", 0, settlement),
        journalLine("Gain on debt extinguishment", 0, gain),
      ].filter((line) => line.debit > 0 || line.credit > 0),
    });
  } else if (!isNewLease) {
    // Liability issue costs reduce the continued carrying amount and are
    // included in the prospective effective-interest basis.
    const effectiveInterestBasis = Math.max(0, oldAmount - retained - newCosts);
    entries.push({
      date: input.effectiveDate,
      kind: "debt_modification",
      memo: `Continue predecessor carrying amount; prospective effective-interest basis ${effectiveInterestBasis.toFixed(2)}`,
      lines: [
        journalLine("Deferred financing fees / transaction costs", retained + newCosts),
        journalLine("Cash / fees payable", 0, newCosts),
        journalLine("Debt carrying amount adjustment", 0, retained),
      ].filter((line) => line.debit > 0 || line.credit > 0),
    });
  }

  if (input.successorKind === "capital_lease") {
    entries.push({
      date: input.effectiveDate,
      kind: "lease_commencement",
      memo: "Recognize successor capital lease at commencement",
      lines: [journalLine("Leased asset", newAmount), journalLine("Capital lease obligation", 0, newAmount)],
    });
  } else if (!isNewLease && treatment === "extinguishment" && input.successorKind === "loan") {
    entries.push({
      date: input.effectiveDate,
      kind: "debt_recognition",
      memo: "Recognize successor debt separately from extinguishment of predecessor debt",
      lines: [journalLine("Cash / consideration received", newAmount), journalLine("Successor debt", 0, newAmount)],
    });
  } else if (isNewLease && input.successorKind === "operating_lease") {
    entries.push({
      date: input.effectiveDate,
      kind: "operating_lease_commencement",
      memo: "Commence successor operating lease; recognize rent on a straight-line basis under ASPE 3065",
      lines: [],
    });
  }
  return entries;
}

export interface AccountingJournalLine {
  account: string;
  debit: number;
  credit: number;
}

export interface AccountingJournalEntry {
  date: string;
  purpose: "day_one_fair_value" | "annual_effective_interest";
  label: string;
  evidence: Record<string, unknown>;
  lines: AccountingJournalLine[];
}

export interface CumulativeFairValueReconciliation {
  date: string;
  purpose: "cumulative_fair_value_reconciliation";
  label: string;
  evidence: Record<string, unknown>;
  dayOneDifference: number;
  priorYearsAccretion: number;
  currentYearAccretion: number;
  cumulativeAccretion: number;
  remainingDiscount: number;
  /** Supporting catch-up presentation only; this is not the recurring entry. */
  lines: AccountingJournalLine[];
}

interface EntryEvidenceInput {
  evidence?: Record<string, unknown>;
}

export interface DayOneFairValueJournalInput extends EntryEvidenceInput {
  recognitionDate: string;
  faceAmount: number;
  fairValue: number;
  isCapitalLease?: boolean;
}

export interface AnnualEffectiveInterestJournalInput extends EntryEvidenceInput {
  entryDate: string;
  fiscalYear: number;
  effectiveInterest: number;
  statedContractualInterest: number;
  isCapitalLease?: boolean;
}

export interface CumulativeFairValueReconciliationInput extends AnnualEffectiveInterestJournalInput {
  dayOneDifference: number;
  priorYearsAccretion: number;
}

const cents = (amount: number): number => Math.round((amount + Number.EPSILON) * 100) / 100;

const signedJournalLine = (account: string, signedDebit: number): AccountingJournalLine => {
  const amount = cents(signedDebit);
  return {
    account,
    debit: amount > 0 ? amount : 0,
    credit: amount < 0 ? -amount : 0,
  };
};

/**
 * Pure day-one entry builder. A positive difference is a discount (face above
 * fair value); a negative difference is a premium. No journal rows are stored.
 */
export function buildDayOneFairValueJournalEntry(input: DayOneFairValueJournalInput): AccountingJournalEntry {
  const difference = cents(input.faceAmount - input.fairValue);
  const liability = input.isCapitalLease ? "Obligation under Capital Lease" : "Loan Payable";
  return {
    date: input.recognitionDate,
    purpose: "day_one_fair_value",
    label: "Day-one fair value recognition",
    evidence: {
      ...(input.evidence ?? {}),
      faceAmount: cents(input.faceAmount),
      fairValue: cents(input.fairValue),
      dayOneDifference: difference,
    },
    lines: [
      signedJournalLine(liability, difference),
      signedJournalLine("Retained Earnings", -difference),
    ].filter((line) => line.debit !== 0 || line.credit !== 0),
  };
}

/**
 * Pure recurring entry builder. It contains only the fiscal year's booked
 * effective interest less stated contractual interest; opening retained
 * earnings belongs exclusively in the separately labelled reconciliation.
 */
export function buildAnnualEffectiveInterestJournalEntry(
  input: AnnualEffectiveInterestJournalInput,
): AccountingJournalEntry {
  const accretion = cents(input.effectiveInterest - input.statedContractualInterest);
  const liability = input.isCapitalLease ? "Obligation under Capital Lease" : "Loan Payable";
  return {
    date: input.entryDate,
    purpose: "annual_effective_interest",
    label: `Annual effective-interest / accretion entry — fiscal ${input.fiscalYear}`,
    evidence: {
      ...(input.evidence ?? {}),
      fiscalYear: input.fiscalYear,
      bookedEffectiveInterest: cents(input.effectiveInterest),
      statedContractualInterest: cents(input.statedContractualInterest),
      currentYearAccretion: accretion,
    },
    lines: [
      signedJournalLine("Interest Expense", accretion),
      signedJournalLine(liability, -accretion),
    ].filter((line) => line.debit !== 0 || line.credit !== 0),
  };
}

/** Build the optional cumulative catch-up support without conflating it with
 * the annual recurring journal entry. */
export function buildCumulativeFairValueReconciliation(
  input: CumulativeFairValueReconciliationInput,
): CumulativeFairValueReconciliation {
  const dayOneDifference = cents(input.dayOneDifference);
  const prior = cents(input.priorYearsAccretion);
  const current = cents(input.effectiveInterest - input.statedContractualInterest);
  const cumulative = cents(prior + current);
  const remaining = cents(dayOneDifference - cumulative);
  const liability = input.isCapitalLease ? "Obligation under Capital Lease" : "Loan Payable";
  return {
    date: input.entryDate,
    purpose: "cumulative_fair_value_reconciliation",
    label: `Cumulative fair value reconciliation — fiscal ${input.fiscalYear} (support only)`,
    evidence: { ...(input.evidence ?? {}), fiscalYear: input.fiscalYear },
    dayOneDifference,
    priorYearsAccretion: prior,
    currentYearAccretion: current,
    cumulativeAccretion: cumulative,
    remainingDiscount: remaining,
    lines: [
      signedJournalLine(liability, remaining),
      signedJournalLine("Interest Expense", current),
      signedJournalLine("Retained Earnings (opening)", prior - dayOneDifference),
    ].filter((line) => line.debit !== 0 || line.credit !== 0),
  };
}

export interface FairValueAccountingEntriesInput {
  loan: BookedScheduleInput;
  /** ISO reporting year end; entries are produced through this date. */
  reportingFiscalYearEnd: string;
  decisionHistory?: FairValueDecisionHistory | null;
  evidence?: Record<string, unknown>;
}

export interface FairValueAccountingEntries {
  treatment: string | null;
  dayOne: AccountingJournalEntry | null;
  annualEntries: AccountingJournalEntry[];
  cumulativeSupport: CumulativeFairValueReconciliation[];
  decisionHistory: FairValueDecisionHistory | null;
}

const contractualBasis = (loan: BookedScheduleInput): BookedScheduleInput => ({
  ...loan,
  fvDecision: null,
  fvRate: null,
  predecessorAgreement: loan.predecessorAgreement ? contractualBasis(loan.predecessorAgreement) : null,
});

/**
 * High-level pure builder shared by loan detail and every export. It uses the
 * frozen recognition-date rate assumption for day one and the date-specific
 * booked/contractual schedules (including transition cut-over) for each year.
 */
export function buildFairValueAccountingEntries(input: FairValueAccountingEntriesInput): FairValueAccountingEntries {
  const { loan } = input;
  const decisionHistory = input.decisionHistory ?? null;
  if (!usesFairValue(loan)) {
    return { treatment: loan.fvDecision ?? null, dayOne: null, annualEntries: [], cumulativeSupport: [], decisionHistory };
  }

  const dayOneBooked = calculateStandaloneBookedSchedule({ ...loan, predecessorAgreement: null });
  if (dayOneBooked.fairValue == null) {
    return { treatment: loan.fvDecision ?? null, dayOne: null, annualEntries: [], cumulativeSupport: [], decisionHistory };
  }
  const faceAmount = Number(loan.principal) - Number(loan.downPayment ?? 0);
  const {
    activeRateEvents: _activeRateEvents,
    rateTimelineEvents: _rateTimelineEvents,
    activeRateSetId: _activeRateSetId,
    activeRateEventCount: _activeRateEventCount,
    ...recognitionEvidence
  } = input.evidence ?? {};
  const dayOneEvidence = {
    ...recognitionEvidence,
    ...dayOneFairValueCalculationEvidence(loan),
    treatment: loan.fvDecision,
    marketEffectiveRate: Number(loan.fvRate),
    paymentTiming: loan.paymentTiming ?? "end",
  };
  const dayOne = buildDayOneFairValueJournalEntry({
    recognitionDate: loan.startDate,
    faceAmount,
    fairValue: dayOneBooked.fairValue,
    isCapitalLease: !!loan.isCapitalLease,
    evidence: dayOneEvidence,
  });

  const booked = calculateBookedSchedule(loan);
  const contractual = calculateBookedSchedule(contractualBasis(loan));
  const reportEnd = parseISO(input.reportingFiscalYearEnd);
  const { month, day } = getFyEndParts(input.reportingFiscalYearEnd);
  const byFiscalYear = (rows: AmortizationRow[]) => {
    const totals = new Map<number, number>();
    for (const row of rows) {
      if (isAfter(row.date, reportEnd)) continue;
      const fiscalYear = getFiscalYear(row.date, month, day);
      totals.set(fiscalYear, (totals.get(fiscalYear) ?? 0) + row.interest);
    }
    return totals;
  };
  const effectiveInterest = byFiscalYear(booked.schedule);
  const statedInterest = byFiscalYear(contractual.schedule);
  const fiscalYears = [...new Set([...effectiveInterest.keys(), ...statedInterest.keys()])].sort((a, b) => a - b);
  const annualEntries: AccountingJournalEntry[] = [];
  const cumulativeSupport: CumulativeFairValueReconciliation[] = [];
  let priorYearsAccretion = 0;
  for (const fiscalYear of fiscalYears) {
    const yearEnd = new Date(fiscalYear, month, day);
    const entryDate = format(isAfter(yearEnd, reportEnd) ? reportEnd : yearEnd, "yyyy-MM-dd");
    const yearInput: AnnualEffectiveInterestJournalInput = {
      entryDate,
      fiscalYear,
      effectiveInterest: effectiveInterest.get(fiscalYear) ?? 0,
      statedContractualInterest: statedInterest.get(fiscalYear) ?? 0,
      isCapitalLease: !!loan.isCapitalLease,
      evidence: {
        ...(input.evidence ?? {}),
        ...loanCalculationEvidence(loan),
        transition: booked.evidenceMetadata?.transition ?? null,
      },
    };
    const annual = buildAnnualEffectiveInterestJournalEntry(yearInput);
    annualEntries.push(annual);
    cumulativeSupport.push(buildCumulativeFairValueReconciliation({
      ...yearInput,
      dayOneDifference: faceAmount - dayOneBooked.fairValue,
      priorYearsAccretion,
    }));
    priorYearsAccretion += yearInput.effectiveInterest - yearInput.statedContractualInterest;
  }
  return { treatment: loan.fvDecision ?? null, dayOne, annualEntries, cumulativeSupport, decisionHistory };
}

/**
 * Whether fair-value treatment actually applies to a loan: the decision is
 * "use_fv" AND a valid (finite, positive) rate is saved. A malformed rate
 * means the contractual basis stands — displays must not label it FV.
 */
export function usesFairValue(loan: {
  fvDecision?: string | null;
  fvRate?: number | string | null;
}): boolean {
  return loan.fvDecision === "use_fv" && isValidFvRate(Number(loan.fvRate));
}

/**
 * The effective rate a loan is booked at: the FV rate when fair-value
 * treatment validly applies, otherwise the contractual rate. Single source
 * of truth for every card, table, workpaper, and export.
 */
export function effectiveLoanRate(loan: {
  fvDecision?: string | null;
  fvRate?: number | string | null;
  interestRate: number | string;
}): number {
  return usesFairValue(loan) ? Number(loan.fvRate) : Number(loan.interestRate);
}

export interface YearlyBreakdown {
  fiscalYear: number;
  label: string;       // e.g. "2025", "Thereafter"
  amount: number;
}

export interface LoanSummary {
  id: string;
  name: string;
  counterparty: string | null;
  description: string;
  interestRate: number;
  maturityDate: string;
  regularPayment: number;
  paymentFrequency: string;
  balanceAtYearEnd: number;
  // Presented current portion. With a covenant violation this is the entire
  // carrying amount (the lender can demand repayment — ASPE 1510).
  currentPortion: number;
  longTermPortion: number;
  // Whether a financial covenant has been violated at the reporting date.
  covenantViolation: boolean;
  // Scheduled repayments due within one year (the normal current portion).
  scheduledWithinOneYear: number;
  // Scheduled repayments due beyond one year. Zero unless a covenant violation
  // reclassifies otherwise-long-term amounts into current.
  scheduledBeyondOneYear: number;
  yearlyPrincipal: YearlyBreakdown[];
  yearlyInterest: { fiscalYear: number; amount: number }[];
  principalRepaidCurrentFY: number;
  isCapitalLease: boolean;
  isOperatingLease: boolean;
  // Combined net book value of the pledged collateral at the reporting year end
  // (null when no collateral is attached).
  collateralNbv?: number | null;
}

export interface CapitalLeaseSummary extends LoanSummary {
  yearlyBlended: YearlyBreakdown[];
  totalMinimumPayments: number;
  impliedInterest: number;
  obligations: number;
}

export interface OperatingLeaseSummary {
  id: string;
  name: string;
  counterparty: string | null;
  description: string;
  monthlyPayment: number;
  termMonths: number;
  startDate: string;
  yearlyPayments: YearlyBreakdown[];
  /** Actual cash rent by fiscal year, including historical transition-owned periods. */
  yearlyCash: { fiscalYear: number; amount: number }[];
  totalCommitment: number;
  deferredRentAtYearEnd: number;
  totalInducements: number;
  monthlyStraightLineExpense: number;
  yearlyStraightLine: { fiscalYear: number; amount: number }[];
  inducementLiabilityCurrent: number;
  inducementLiabilityNonCurrent: number;
}

/**
 * Operating-lease classification. An item is an operating lease only when it
 * is not a capital lease, has a 0% rate, a monthly payment, AND a lease term
 * in months. The termMonths requirement distinguishes genuine operating
 * leases (created via the lease wizard, which always sets termMonths) from
 * 0% interest loans (which use termYears/amortizationYears instead).
 */
export function isOperatingLeaseLoan(loan: {
  isCapitalLease: boolean;
  interestRate: string | number;
  monthlyPayment?: string | number | null;
  termMonths?: number | null;
}): boolean {
  return (
    !loan.isCapitalLease &&
    Number(loan.interestRate) === 0 &&
    loan.monthlyPayment != null &&
    loan.termMonths != null
  );
}

export function buildFiscalYearLabel(
  fiscalYear: number,
  fyEndMonth: number,
  fyEndDay: number
): string {
  const start = new Date(fiscalYear - 1, fyEndMonth, fyEndDay);
  start.setDate(start.getDate() + 1);
  const end = new Date(fiscalYear, fyEndMonth, fyEndDay);
  return `${fiscalYear}`;
}

export function computeMaturityDate(
  startDate: string,
  termYears: number,
  termMonths?: number | null
): Date {
  const start = parseISO(startDate);
  if (termMonths != null && termMonths > 0) {
    return addMonths(start, termMonths);
  }
  return addMonths(start, termYears * 12);
}

export function getFirstRegularPayment(schedule: AmortizationRow[]): number {
  if (schedule.length === 0) return 0;
  // Find first row that isn't interest-only
  const firstRegular = schedule.find((r) => !r.isInterestOnly && !r.isGrace);
  if (firstRegular) return firstRegular.payment;
  // If all interest-only, use the first payment amount
  return schedule[0].payment;
}

// ---- Security clauses & collateral net book value ----

const UNSECURED_CLAUSE = "Unsecured";
const EQUIPMENT_CHARGE_CLAUSE = "Specific charge on equipment";
const REAL_PROPERTY_CHARGE_CLAUSE =
  "Specific charge / mortgage on real property (land & building)";

const SECURITY_CLAUSE_PHRASES: Record<string, string> = {
  "General security agreement (GSA)": "a general security agreement",
  [REAL_PROPERTY_CHARGE_CLAUSE]: "a specific charge over the real property",
  [EQUIPMENT_CHARGE_CLAUSE]: "a specific charge over equipment",
  "Personal guarantee(s)": "personal guarantee(s)",
  "Assignment of rents / leases": "an assignment of rents and leases",
  "Pledge of investments / shares": "a pledge of investments and shares",
  "Assignment of insurance": "an assignment of insurance",
  "Postponement / subordination of shareholder loans":
    "a postponement of shareholder loans",
  "Corporate guarantee from a related/parent company":
    "a corporate guarantee from a related company",
  "Assignment of specific accounts receivable / contracts":
    "an assignment of specific accounts receivable and contracts",
  "Pledge of cash / GIC": "a pledge of cash and guaranteed investment certificates",
};

export interface CollateralFields {
  collateralType?: string | null;
  collateralDescription?: string | null;
  collateralDepreciableCost?: number | string | null;
  collateralLandCost?: number | string | null;
  collateralInServiceDate?: string | null;
  collateralMethod?: string | null;
  collateralUsefulLifeYears?: number | null;
  collateralDecliningRate?: number | string | null;
  collateralSalvageValue?: number | string | null;
}

function naturalJoin(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function collateralNoun(
  type: string | null | undefined,
  description: string | null | undefined
): string {
  const desc = description?.trim();
  if (desc) return desc;
  switch (type) {
    case "equipment":
      return "equipment";
    case "building":
      return "a building";
    case "land":
      return "land";
    case "land_and_building":
      return "land and building";
    default:
      return "collateral";
  }
}

/**
 * Net book value of a depreciable asset at the reporting fiscal year end. The
 * acquisition fiscal year is prorated by the number of months the asset was
 * held (the acquisition month counts as a full month); every subsequent fiscal
 * year through the reporting year is a complete year. Supports straight-line
 * (cost ÷ useful life) and declining balance (rate × opening NBV). NBV is
 * floored at the salvage value.
 */
function depreciableNbv(
  cost: number,
  inServiceDate: string | null | undefined,
  method: string | null | undefined,
  usefulLifeYears: number | null | undefined,
  decliningRatePct: number,
  salvage: number,
  reportYearEnd: Date,
  fyEndMonth: number,
  fyEndDay: number
): number {
  if (!(cost > 0)) return Math.max(0, cost);
  if (!inServiceDate) return cost; // cannot depreciate without an in-service date
  const inService = parseISO(inServiceDate);
  // Placed in service after the reporting year end: not yet depreciated.
  if (isAfter(inService, reportYearEnd)) return cost;

  const salvageFloor = Math.min(Math.max(salvage, 0), cost);
  const depreciableBase = cost - salvageFloor;
  if (depreciableBase <= 0) return cost;

  const useDeclining = method === "declining_balance";
  const rate = decliningRatePct / 100;
  if (useDeclining) {
    if (!(rate > 0)) return cost;
  } else if (!usefulLifeYears || usefulLifeYears <= 0) {
    return cost;
  }

  const acqFY = getFiscalYear(inService, fyEndMonth, fyEndDay);
  const reportFY = getFiscalYear(reportYearEnd, fyEndMonth, fyEndDay);

  // Months held during the acquisition fiscal year (acquisition month counts).
  const acqFyEnd = new Date(acqFY, fyEndMonth, fyEndDay);
  const monthsHeld = Math.min(
    12,
    Math.max(
      0,
      (acqFyEnd.getFullYear() - inService.getFullYear()) * 12 +
        (acqFyEnd.getMonth() - inService.getMonth()) +
        1
    )
  );

  let nbv = cost;
  for (let fy = acqFY; fy <= reportFY; fy++) {
    const fraction = fy === acqFY ? monthsHeld / 12 : 1;
    let dep = useDeclining
      ? nbv * rate * fraction
      : (depreciableBase / usefulLifeYears!) * fraction;
    dep = Math.min(dep, nbv - salvageFloor);
    if (dep < 0) dep = 0;
    nbv -= dep;
  }
  return nbv;
}

export interface AssetDepreciationRow {
  fiscalYear: number;
  openingNbv: number;
  depreciation: number;
  accumulated: number;
  closingNbv: number;
}

/**
 * Full year-by-year depreciation schedule for a depreciable asset, using the
 * exact same conventions as `depreciableNbv` (acquisition fiscal year prorated
 * by months held with the acquisition month counting as a full month,
 * straight-line or declining balance, NBV floored at salvage) so each row's
 * closing NBV ties to the collateral NBV disclosed at that fiscal year end.
 * Returns an empty array when the inputs cannot produce a schedule.
 */
export function buildAssetDepreciationSchedule(
  cost: number,
  inServiceDate: string | null | undefined,
  method: string | null | undefined,
  usefulLifeYears: number | null | undefined,
  decliningRatePct: number,
  salvage: number,
  fyEndMonth: number,
  fyEndDay: number
): AssetDepreciationRow[] {
  if (!(cost > 0) || !inServiceDate) return [];
  const inService = parseISO(inServiceDate);
  if (isNaN(inService.getTime())) return [];

  const salvageFloor = Math.min(Math.max(salvage, 0), cost);
  const depreciableBase = cost - salvageFloor;
  if (depreciableBase <= 0) return [];

  const useDeclining = method === "declining_balance";
  const rate = decliningRatePct / 100;
  if (useDeclining) {
    if (!(rate > 0)) return [];
  } else if (!usefulLifeYears || usefulLifeYears <= 0) {
    return [];
  }

  const acqFY = getFiscalYear(inService, fyEndMonth, fyEndDay);

  // Months held during the acquisition fiscal year (acquisition month counts).
  const acqFyEnd = new Date(acqFY, fyEndMonth, fyEndDay);
  const monthsHeld = Math.min(
    12,
    Math.max(
      0,
      (acqFyEnd.getFullYear() - inService.getFullYear()) * 12 +
        (acqFyEnd.getMonth() - inService.getMonth()) +
        1
    )
  );

  const rows: AssetDepreciationRow[] = [];
  const MAX_YEARS = 100;
  let nbv = cost;
  let accumulated = 0;
  for (let i = 0; i < MAX_YEARS; i++) {
    const fy = acqFY + i;
    const fraction = fy === acqFY ? monthsHeld / 12 : 1;
    let dep = useDeclining
      ? nbv * rate * fraction
      : (depreciableBase / usefulLifeYears!) * fraction;
    dep = Math.min(dep, nbv - salvageFloor);
    if (dep < 0) dep = 0;
    const opening = nbv;
    nbv -= dep;
    accumulated += dep;
    rows.push({
      fiscalYear: fy,
      openingNbv: opening,
      depreciation: dep,
      accumulated,
      closingNbv: nbv,
    });
    if (nbv - salvageFloor <= 0.005) break;
  }
  return rows;
}

/**
 * Combined net book value of the single collateral asset pledged against a
 * loan/lease. "land_and_building" adds the non-amortized land cost to the
 * depreciated building NBV. Returns null when no collateral is attached.
 */
export function computeCollateralNbv(
  c: CollateralFields,
  reportYearEnd: Date,
  fyEndMonth: number,
  fyEndDay: number
): number | null {
  const type = c.collateralType;
  if (!type) return null;

  const land = c.collateralLandCost != null ? Number(c.collateralLandCost) : 0;
  const depCost =
    c.collateralDepreciableCost != null ? Number(c.collateralDepreciableCost) : 0;
  const salvage =
    c.collateralSalvageValue != null ? Number(c.collateralSalvageValue) : 0;
  const life = c.collateralUsefulLifeYears ?? null;
  const rate = c.collateralDecliningRate != null ? Number(c.collateralDecliningRate) : 0;

  if (type === "land") {
    const value = land > 0 ? land : depCost;
    return value > 0 ? value : null;
  }

  const depNbv =
    depCost > 0
      ? depreciableNbv(
          depCost,
          c.collateralInServiceDate,
          c.collateralMethod,
          life,
          rate,
          salvage,
          reportYearEnd,
          fyEndMonth,
          fyEndDay
        )
      : 0;
  const landComponent = type === "land_and_building" ? land : 0;
  const total = depNbv + landComponent;
  return total > 0 ? total : null;
}

/**
 * Builds the trailing security phrase for the disclosure sentence, e.g.
 * " and is secured by a general security agreement and equipment having a net
 * book value of $X at year end." Returns "." when nothing is pledged (capital
 * leases fall back to the standard specific-equipment wording).
 */
function buildSecurityText(
  clauses: string[],
  collateralType: string | null | undefined,
  collateralDescription: string | null | undefined,
  collateralNbv: number | null,
  isCapital: boolean
): string {
  const cleaned = clauses.filter((c) => c && c.trim().length > 0);

  // "Unsecured" as the sole selection overrides everything else.
  if (cleaned.length === 1 && cleaned[0] === UNSECURED_CLAUSE) {
    return " and is unsecured.";
  }
  const effective = cleaned.filter((c) => c !== UNSECURED_CLAUSE);

  const nbvText =
    collateralNbv != null
      ? ` having ${
          collateralType === "land_and_building" ? "a combined " : "a "
        }net book value of ${formatMoney(collateralNbv)} at year end`
      : "";
  const isEquipmentColl = collateralType === "equipment";
  const isRealPropertyColl =
    collateralType === "building" ||
    collateralType === "land" ||
    collateralType === "land_and_building";

  const descriptors: string[] = [];
  let attached = false;
  for (const clause of effective) {
    let phrase = SECURITY_CLAUSE_PHRASES[clause] ?? clause;
    if (collateralNbv != null && !attached) {
      if (
        (clause === EQUIPMENT_CHARGE_CLAUSE && isEquipmentColl) ||
        (clause === REAL_PROPERTY_CHARGE_CLAUSE && isRealPropertyColl)
      ) {
        phrase += nbvText;
        attached = true;
      }
    }
    descriptors.push(phrase);
  }

  // Collateral present but no matching charge clause: add it as its own item.
  if (collateralNbv != null && !attached) {
    descriptors.push(`${collateralNoun(collateralType, collateralDescription)}${nbvText}`);
  }

  if (descriptors.length === 0) {
    return isCapital ? " and is secured by specific equipment." : ".";
  }
  return ` and is secured by ${naturalJoin(descriptors)}.`;
}

export function buildLoanSummary(
  loan: {
    id: string;
    name: string;
    counterparty?: string | null;
    principal: number | string;
    downPayment?: number | string | null;
    interestRate: number | string;
    amortizationYears: number;
    termYears: number;
    startDate: string | null;
    ioMonths?: number | null;
    specificIoMonths?: string | null;
    balloonPayment?: number | string | null;
    paymentFrequency?: string | null;
    paymentTiming?: "beginning" | "end" | null;
    graceTermMode?: "included" | "added" | null;
    firstPaymentDate?: string | null;
    semiMonthlyFirstDueDay?: number | null;
    semiMonthlySecondDueDay?: number | null;
    isCapitalLease?: boolean | null;
    monthlyPayment?: number | string | null;
    paymentOverride?: number | string | null;
    firstPaymentAmount?: number | string | null;
    graceMonths?: number | null;
    graceInterestTreatment?: string | null;
    termMonths?: number | null;
    freeRentMonths?: number | null;
    rentEscalationRate?: number | string | null;
    rentSteps?: Array<{ fromYear: number; toYear: number; monthlyRent: number }> | null;
    tenantImprovementAllowance?: number | string | null;
    otherInducements?: number | string | null;
    fvDecision?: string | null;
    fvRate?: number | string | null;
    rateType?: BookedScheduleInput["rateType"];
    rateBenchmark?: string | null;
    contractualPrimeName?: string | null;
    benchmarkEquivalentToContractualPrime?: boolean | null;
    rateSpread?: number | string | null;
    rateResetFrequency?: string | null;
    rateEffectiveConvention?: string | null;
    ratePaymentTreatment?: BookedScheduleInput["ratePaymentTreatment"];
    rateTimelineEvents?: RateTimelineEvent[] | null;
    activeRateEvents?: readonly unknown[] | null;
    activeRateSetId?: string | null;
    initialFvRateAssumption?: Record<string, unknown> | null;
    covenantViolation?: boolean | null;
    securityClauses?: string[] | null;
    collateralType?: string | null;
    collateralDescription?: string | null;
    collateralDepreciableCost?: number | string | null;
    collateralLandCost?: number | string | null;
    collateralInServiceDate?: string | null;
    collateralMethod?: string | null;
    collateralUsefulLifeYears?: number | null;
    collateralDecliningRate?: number | string | null;
    collateralSalvageValue?: number | string | null;
    activeEvents?: BookedScheduleInput["activeEvents"];
    currentRevisionId?: string | null;
    currentRevisionHash?: string | null;
    calculationVersion?: string | null;
    activeEventSetId?: string | null;
    activeEventSetVersion?: number | null;
    activeEventSetHash?: string | null;
    predecessorAgreement?: BookedScheduleInput | null;
    predecessorAgreementId?: string | null;
    modificationEffectiveDate?: string | null;
    modificationAssessment?: AgreementModificationAssessment | null;
  },
  reportYearEnd: Date,
  fyEndDate: string
): LoanSummary | CapitalLeaseSummary | OperatingLeaseSummary | null {
  if (!loan.startDate || !fyEndDate) return null;
  const { month: fyEndMonth, day: fyEndDay } = getFyEndParts(fyEndDate);
  // Financed amount actually amortized: face principal net of any down payment.
  const principal = Number(loan.principal) - Number(loan.downPayment ?? 0);
  const rawRate = Number(loan.interestRate);
  const interestRate = effectiveLoanRate(loan);
  const isCapital = !!loan.isCapitalLease;
  const isOperating = isOperatingLeaseLoan({
    isCapitalLease: isCapital,
    interestRate: loan.interestRate,
    monthlyPayment: loan.monthlyPayment,
    termMonths: loan.termMonths,
  });

  if (isOperating) {
    const monthlyPayment = Number(loan.monthlyPayment ?? 0);
    const termMonths = loan.termMonths ?? 0;
    let totalCommitment = monthlyPayment * termMonths;
    const startDate = parseISO(loan.startDate);
    // Cash-commitment buckets follow the contractual first due date when it is
    // known. Straight-line expense deliberately remains based on lease
    // inception/term, not payment timing.
    const paymentStartDate =
      loan.firstPaymentDate && !isNaN(parseISO(loan.firstPaymentDate).getTime())
        ? parseISO(loan.firstPaymentDate)
        : startDate;

    // Build year-by-year operating lease payments
    const yearlyMap = new Map<number, number>();
    const steps = (loan.rentSteps ?? [])
      .filter((s) => s.monthlyRent > 0 && s.fromYear >= 1 && s.toYear >= s.fromYear)
      .sort((a, b) => a.fromYear - b.fromYear);
    for (let i = 0; i < termMonths; i++) {
      const paymentDate = addMonths(paymentStartDate, i);
      if (!isAfter(paymentDate, reportYearEnd)) continue; // only future
      const fy = getFiscalYear(paymentDate, fyEndMonth, fyEndDay);
      let rent = monthlyPayment;
      if (steps.length > 0) {
        const leaseYear = Math.floor(i / 12) + 1;
        const step = steps.find((s) => leaseYear >= s.fromYear && leaseYear <= s.toYear);
        rent = step ? step.monthlyRent : steps[steps.length - 1].monthlyRent;
      }
      if (i < (loan.freeRentMonths ?? 0)) rent = 0;
      yearlyMap.set(fy, (yearlyMap.get(fy) ?? 0) + rent);
    }

    // Convert to array, merge "Thereafter" for years beyond the first 5 distinct fiscal years
    const entries = Array.from(yearlyMap.entries()).sort((a, b) => a[0] - b[0]);
    let yearlyPayments: YearlyBreakdown[] = [];
    let thereAfterTotal = 0;
    const maxYears = 5;
    for (let i = 0; i < entries.length; i++) {
      if (i < maxYears) {
        yearlyPayments.push({
          fiscalYear: entries[i][0],
          label: `${entries[i][0]}`,
          amount: entries[i][1],
        });
      } else {
        thereAfterTotal += entries[i][1];
      }
    }
    if (thereAfterTotal > 0) {
      yearlyPayments.push({
        fiscalYear: entries[entries.length - 1]?.[0] ?? 0,
        label: "Thereafter",
        amount: thereAfterTotal,
      });
    }

    // Straight-line expense computation
    const sl = calculateStraightLineLease({
      baseMonthlyRent: monthlyPayment,
      termMonths,
      freeRentMonths: loan.freeRentMonths ?? 0,
      escalationRate: Number(loan.rentEscalationRate ?? 0),
      rentSteps: loan.rentSteps ?? [],
      tenantImprovementAllowance: Number(loan.tenantImprovementAllowance ?? 0),
      otherInducements: Number(loan.otherInducements ?? 0),
      startDate: loan.startDate,
      fiscalYearEnd: fyEndDate,
    });
    if (sl) totalCommitment = sl.totalLeasePayments;
    let deferredRentAtYearEnd = sl?.deferredRentAtYearEnd ?? 0;
    let totalInducements = sl?.totalInducements ?? 0;
    let monthlyStraightLineExpense = sl?.monthlyStraightLineExpense ?? monthlyPayment;
    let yearly = sl ? buildYearlyStraightLine(sl.schedule) : [];
    let inducementLiabilityCurrent = sl?.inducementLiabilityCurrent ?? 0;
    let inducementLiabilityNonCurrent = sl?.inducementLiabilityNonCurrent ?? 0;

    const predecessor = loan.predecessorAgreement;
    const effective = dateOrUndefined(loan.modificationEffectiveDate);
    const assessment = loan.modificationAssessment;
    if (
      predecessor &&
      effective &&
      assessment?.status === "confirmed" &&
      isOperatingLeaseLoan({
        isCapitalLease: !!predecessor.isCapitalLease,
        interestRate: predecessor.interestRate,
        monthlyPayment: predecessor.monthlyPayment,
        termMonths: predecessor.termMonths,
      })
    ) {
      const predecessorSl = calculateStraightLineLease({
        baseMonthlyRent: Number(predecessor.monthlyPayment ?? 0),
        termMonths: predecessor.termMonths ?? 0,
        freeRentMonths: predecessor.freeRentMonths ?? 0,
        escalationRate: Number(predecessor.rentEscalationRate ?? 0),
        rentSteps: predecessor.rentSteps ?? [],
        tenantImprovementAllowance: Number(predecessor.tenantImprovementAllowance ?? 0),
        otherInducements: Number(predecessor.otherInducements ?? 0),
        startDate: predecessor.startDate,
        fiscalYearEnd: fyEndDate,
      });
      if (predecessorSl && sl) {
        const q = assessment.evidence.quantitativeTest;
        const successorOwnsEffectiveDate =
          assessment.conclusion.accountingTreatment !== "new_lease" &&
          q?.sameDayPaymentTreatment === "include";
        const dated = (
          result: NonNullable<ReturnType<typeof calculateStraightLineLease>>,
          agreementStart: string,
          owner: "predecessor" | "successor",
        ) => {
          const anchor = parseISO(agreementStart);
          return result.schedule.map((period) => ({
            ...period,
            date: addMonths(anchor, period.monthIndex),
            owner,
          }));
        };
        const ownedPredecessor = dated(predecessorSl, predecessor.startDate, "predecessor").filter((period) =>
          successorOwnsEffectiveDate ? period.date < effective : period.date <= effective,
        );
        let ownedSuccessor = dated(sl, loan.startDate, "successor").filter((period) =>
          successorOwnsEffectiveDate ? period.date >= effective : period.date > effective,
        );
        // The predecessor termination clears its balances at the boundary.
        // Restart the successor deferred-rent continuity at the first period it
        // owns rather than carrying an excluded commencement-date period.
        const successorOpeningDeferred = ownedSuccessor.length > 0
          ? ownedSuccessor[0].cumulativeDeferredRent - ownedSuccessor[0].difference
          : 0;
        ownedSuccessor = ownedSuccessor.map((period) => ({
          ...period,
          cumulativeDeferredRent: period.cumulativeDeferredRent - successorOpeningDeferred,
        }));
        const combined = [...ownedPredecessor, ...ownedSuccessor].sort((a, b) => a.date.getTime() - b.date.getTime());

        totalCommitment = combined.reduce((sum, period) => sum + period.actualPayment, 0);
        const futureCash = new Map<number, number>();
        const annual = new Map<number, { actual: number; straightLine: number; difference: number; deferredRent: number }>();
        for (const period of combined) {
          const fiscalYear = getFiscalYear(period.date, fyEndMonth, fyEndDay);
          if (isAfter(period.date, reportYearEnd)) {
            futureCash.set(fiscalYear, (futureCash.get(fiscalYear) ?? 0) + period.actualPayment);
          }
          const item = annual.get(fiscalYear) ?? { actual: 0, straightLine: 0, difference: 0, deferredRent: 0 };
          item.actual += period.actualPayment;
          item.straightLine += period.straightLineExpense;
          item.difference += period.difference;
          item.deferredRent = period.cumulativeDeferredRent;
          annual.set(fiscalYear, item);
        }
        const futureEntries = Array.from(futureCash.entries()).sort((a, b) => a[0] - b[0]);
        yearlyPayments = futureEntries.slice(0, 5).map(([fiscalYear, amount]) => ({ fiscalYear, label: `${fiscalYear}`, amount }));
        const thereafter = futureEntries.slice(5).reduce((sum, [, amount]) => sum + amount, 0);
        if (thereafter > 0) yearlyPayments.push({ fiscalYear: futureEntries.at(-1)?.[0] ?? 0, label: "Thereafter", amount: thereafter });
        yearly = Array.from(annual.entries()).sort((a, b) => a[0] - b[0]).map(([fiscalYear, values]) => ({ fiscalYear, ...values }));

        const lastOwnedAtYearEnd = combined.filter((period) => !isAfter(period.date, reportYearEnd)).at(-1);
        deferredRentAtYearEnd = lastOwnedAtYearEnd?.cumulativeDeferredRent ?? 0;
        const predecessorInducementShare = predecessorSl.totalInducements * ownedPredecessor.length / predecessorSl.schedule.length;
        const successorInducementShare = sl.totalInducements * ownedSuccessor.length / sl.schedule.length;
        totalInducements = predecessorInducementShare + successorInducementShare;
        const nextYearEnd = new Date(reportYearEnd);
        nextYearEnd.setFullYear(nextYearEnd.getFullYear() + 1);
        if (lastOwnedAtYearEnd?.owner === "predecessor") {
          monthlyStraightLineExpense = predecessorSl.monthlyStraightLineExpense;
          const monthlyInducement = predecessorSl.totalInducements / predecessorSl.schedule.length;
          const elapsed = ownedPredecessor.filter((period) => !isAfter(period.date, reportYearEnd)).length;
          const nextYear = ownedPredecessor.filter((period) => isAfter(period.date, reportYearEnd) && !isAfter(period.date, nextYearEnd)).length;
          const remaining = Math.max(0, predecessorSl.totalInducements - elapsed * monthlyInducement);
          inducementLiabilityCurrent = Math.min(remaining, nextYear * monthlyInducement);
          inducementLiabilityNonCurrent = Math.max(0, remaining - inducementLiabilityCurrent);
        } else {
          const monthlyInducement = sl.totalInducements / sl.schedule.length;
          const elapsed = ownedSuccessor.filter((period) => !isAfter(period.date, reportYearEnd)).length;
          const nextYear = ownedSuccessor.filter((period) => isAfter(period.date, reportYearEnd) && !isAfter(period.date, nextYearEnd)).length;
          const remaining = Math.max(0, sl.totalInducements - elapsed * monthlyInducement);
          inducementLiabilityCurrent = Math.min(remaining, nextYear * monthlyInducement);
          inducementLiabilityNonCurrent = Math.max(0, remaining - inducementLiabilityCurrent);
        }
      }
    }

    const opCp = loan.counterparty?.trim() || null;
    const opNarrativeBase = opCp
      ? `Operating lease with ${opCp}.`
      : "Operating lease.";
    const opNarrative = loan.modificationAssessment?.status === "confirmed" && loan.modificationEffectiveDate
      ? loan.modificationAssessment.conclusion.accountingTreatment === "new_lease"
        ? `${opNarrativeBase} This is a new operating lease commencing under ASPE 3065 effective ${loan.modificationEffectiveDate}; predecessor lease balances are cleared at that date.`
        : `${opNarrativeBase} This agreement replaces its linked predecessor effective ${loan.modificationEffectiveDate}; the predecessor is reported through that date and this lease afterward.`
      : opNarrativeBase;

    return {
      id: loan.id,
      name: loan.name,
      counterparty: opCp,
      description: opNarrative,
      monthlyPayment,
      termMonths,
      startDate: loan.startDate,
      yearlyPayments,
      yearlyCash: yearly.map((y) => ({ fiscalYear: y.fiscalYear, amount: y.actual })),
      totalCommitment,
      deferredRentAtYearEnd,
      totalInducements,
      monthlyStraightLineExpense,
      yearlyStraightLine: yearly.map((y) => ({ fiscalYear: y.fiscalYear, amount: y.straightLine })),
      inducementLiabilityCurrent,
      inducementLiabilityNonCurrent,
    } as OperatingLeaseSummary;
  }

  // Regular loan or capital lease. When fair value is adopted, the booked
  // schedule keeps the contractual payments fixed (effective-interest method).
  // startDate is guaranteed non-null by the guard at the top of this function.
  const result = calculateBookedSchedule({ ...loan, startDate: loan.startDate! });

  const currentPeriodEnd = new Date(reportYearEnd);
  currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);

  const balanceAtYearEnd =
    result.schedule
      .filter((row) => !isAfter(row.date, reportYearEnd))
      .slice(-1)[0]?.balance ?? principal;

  // When the term is shorter than the amortization period, the schedule ends at
  // term end with a residual balance still owed (an implicit balloon due at
  // maturity). This residual is never captured as a principal payment row, so it
  // must be recognized as principal due in the maturity fiscal year for the
  // repayment-terms disclosure to reconcile to the carrying amount.
  const lastRow = result.schedule[result.schedule.length - 1];
  const residualBalloon =
    lastRow && isAfter(lastRow.date, reportYearEnd) ? lastRow.balance : 0;

  let currentPortion = result.schedule
    .filter((row) => isAfter(row.date, reportYearEnd) && !isAfter(row.date, currentPeriodEnd))
    .reduce((sum, row) => sum + row.principal, 0);
  // If the loan matures within the next fiscal year, the residual balloon is due
  // within one year and belongs in the current portion.
  if (residualBalloon > 0.01 && lastRow && !isAfter(lastRow.date, currentPeriodEnd)) {
    currentPortion += residualBalloon;
  }

  let longTermPortion = Math.max(0, balanceAtYearEnd - currentPortion);

  // Financial covenant violation: the counterparty has the right to demand
  // repayment, so the entire obligation is classified as current (ASPE 1510).
  // We still track the scheduled split for disclosure.
  const covenantViolation = !!loan.covenantViolation;
  const scheduledWithinOneYear = currentPortion;
  const scheduledBeyondOneYear = covenantViolation ? longTermPortion : 0;
  if (covenantViolation) {
    currentPortion = balanceAtYearEnd;
    longTermPortion = 0;
  }

  // Build narrative description
  const freqLabel = loan.paymentFrequency ?? "monthly";
  const freqWord =
    freqLabel === "semi-monthly"
      ? "semi-monthly blended"
      : freqLabel === "bi-weekly"
      ? "bi-weekly blended"
      : freqLabel === "weekly"
      ? "weekly blended"
      : "monthly blended";

  const maturityDate = computeMaturityDate(loan.startDate, loan.termYears, loan.termMonths);
  const regularPayment = getFirstRegularPayment(result.schedule);

  const rateText =
    interestRate === 0
      ? "no interest"
      : `interest at ${interestRate.toFixed(2)}% per annum`;

  const cp = loan.counterparty?.trim() || null;
  const paymentText = `${regularPayment.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const collateralNbv = computeCollateralNbv(loan, reportYearEnd, fyEndMonth, fyEndDay);
  const securityText = buildSecurityText(
    loan.securityClauses ?? [],
    loan.collateralType,
    loan.collateralDescription,
    collateralNbv,
    isCapital
  );
  const leadIn = isCapital
    ? `Capital lease ${cp ? `with ${cp} ` : ""}bearing ${rateText}, repayable in ${freqWord} payments of $${paymentText}`
    : `Loan ${cp ? `from ${cp} ` : ""}bearing ${rateText}, repayable in ${freqWord} payments of $${paymentText}`;
  const transitionDisclosure = loan.modificationAssessment?.status === "confirmed" && loan.modificationEffectiveDate
    ? loan.modificationAssessment.conclusion.accountingTreatment === "new_lease"
      ? ` This agreement is a new lease commencing under ASPE 3065 effective ${loan.modificationEffectiveDate}; any predecessor lease is terminated or derecognized at that date and this lease is reported thereafter.`
      : ` This agreement replaces its linked predecessor effective ${loan.modificationEffectiveDate} and is accounted for as a ${loan.modificationAssessment.conclusion.accountingTreatment}; predecessor activity is retained through the effective date and successor activity thereafter.`
    : "";
  const narrative = `${leadIn}. The ${isCapital ? "lease" : "loan"} matures on ${formatDate(maturityDate)}${securityText}${transitionDisclosure}`;

  // Year-by-year principal repayments (future years only, for the repayment-terms disclosure)
  // and principal repaid during the current reporting fiscal year (for the cash flow statement).
  const reportFY = getFiscalYear(reportYearEnd, fyEndMonth, fyEndDay);
  const principalYearlyMap = new Map<number, number>();
  let principalRepaidCurrentFY = 0;
  for (const row of result.schedule) {
    const rowFY = getFiscalYear(row.date, fyEndMonth, fyEndDay);
    if (isAfter(row.date, reportYearEnd)) {
      principalYearlyMap.set(rowFY, (principalYearlyMap.get(rowFY) ?? 0) + row.principal);
    } else if (rowFY === reportFY) {
      principalRepaidCurrentFY += row.principal;
    }
  }
  // Recognize the residual balloon as principal due in the maturity fiscal year.
  if (residualBalloon > 0.01 && lastRow) {
    const maturityFY = getFiscalYear(lastRow.date, fyEndMonth, fyEndDay);
    principalYearlyMap.set(maturityFY, (principalYearlyMap.get(maturityFY) ?? 0) + residualBalloon);
  }
  const principalEntries = Array.from(principalYearlyMap.entries()).sort((a, b) => a[0] - b[0]);
  const yearlyPrincipal: YearlyBreakdown[] = [];
  let pThereAfter = 0;
  for (let i = 0; i < principalEntries.length; i++) {
    if (i < 5) {
      yearlyPrincipal.push({
        fiscalYear: principalEntries[i][0],
        label: `${principalEntries[i][0]}`,
        amount: principalEntries[i][1],
      });
    } else {
      pThereAfter += principalEntries[i][1];
    }
  }
  if (pThereAfter > 0) {
    yearlyPrincipal.push({
      fiscalYear: principalEntries[principalEntries.length - 1]?.[0] ?? 0,
      label: "Thereafter",
      amount: pThereAfter,
    });
  }

  // Year-by-year interest (for P&L)
  const interestYearlyMap = new Map<number, number>();
  for (const row of result.schedule) {
    const fy = getFiscalYear(row.date, fyEndMonth, fyEndDay);
    interestYearlyMap.set(fy, (interestYearlyMap.get(fy) ?? 0) + row.interest);
  }
  const yearlyInterest = Array.from(interestYearlyMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([fiscalYear, amount]) => ({ fiscalYear, amount }));

  if (isCapital) {
    // Year-by-year blended (future minimum lease payments)
    const blendedYearlyMap = new Map<number, number>();
    for (const row of result.schedule) {
      if (isAfter(row.date, reportYearEnd)) {
        const fy = getFiscalYear(row.date, fyEndMonth, fyEndDay);
        blendedYearlyMap.set(fy, (blendedYearlyMap.get(fy) ?? 0) + row.payment);
      }
    }
    // Include the residual balloon due at maturity (when the term is shorter than
    // the amortization period) as a minimum lease payment, so total minimum
    // payments and the implied interest reconcile to the recorded obligation.
    if (residualBalloon > 0.01 && lastRow) {
      const maturityFY = getFiscalYear(lastRow.date, fyEndMonth, fyEndDay);
      blendedYearlyMap.set(maturityFY, (blendedYearlyMap.get(maturityFY) ?? 0) + residualBalloon);
    }
    const blendedEntries = Array.from(blendedYearlyMap.entries()).sort((a, b) => a[0] - b[0]);
    const yearlyBlended: YearlyBreakdown[] = [];
    let bThereAfter = 0;
    for (let i = 0; i < blendedEntries.length; i++) {
      if (i < 5) {
        yearlyBlended.push({
          fiscalYear: blendedEntries[i][0],
          label: `${blendedEntries[i][0]}`,
          amount: blendedEntries[i][1],
        });
      } else {
        bThereAfter += blendedEntries[i][1];
      }
    }
    if (bThereAfter > 0) {
      yearlyBlended.push({
        fiscalYear: blendedEntries[blendedEntries.length - 1]?.[0] ?? 0,
        label: "Thereafter",
        amount: bThereAfter,
      });
    }

    const totalMinimumPayments = yearlyBlended.reduce((s, y) => s + y.amount, 0);
    const obligations = balanceAtYearEnd; // Present value = balance at year end
    const impliedInterest = totalMinimumPayments - obligations;

    return {
      id: loan.id,
      name: loan.name,
      counterparty: cp,
      description: narrative,
      interestRate,
      maturityDate: formatDate(maturityDate),
      regularPayment,
      paymentFrequency: freqLabel,
      balanceAtYearEnd,
      currentPortion,
      longTermPortion,
      covenantViolation,
      scheduledWithinOneYear,
      scheduledBeyondOneYear,
      yearlyPrincipal,
      yearlyInterest,
      yearlyBlended,
      totalMinimumPayments,
      impliedInterest: Math.max(0, impliedInterest),
      obligations,
      principalRepaidCurrentFY,
      isCapitalLease: true,
      isOperatingLease: false,
      collateralNbv,
    } as CapitalLeaseSummary;
  }

  return {
    id: loan.id,
    name: loan.name,
    counterparty: cp,
    description: narrative,
    interestRate,
    maturityDate: formatDate(maturityDate),
    regularPayment,
    paymentFrequency: freqLabel,
    balanceAtYearEnd,
    currentPortion,
    longTermPortion,
    covenantViolation,
    scheduledWithinOneYear,
    scheduledBeyondOneYear,
    yearlyPrincipal,
    yearlyInterest,
    principalRepaidCurrentFY,
    isCapitalLease: false,
    isOperatingLease: false,
    collateralNbv,
  } as LoanSummary;
}

function formatDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" };
  return date.toLocaleDateString("en-US", options);
}

export interface FileSummary {
  loans: LoanSummary[];
  capitalLeases: CapitalLeaseSummary[];
  operatingLeases: OperatingLeaseSummary[];
  loanTotal: number;
  leaseTotal: number;
  loanCurrent: number;
  loanLongTerm: number;
  leaseCurrent: number;
  leaseLongTerm: number;
  totalDebt: number;
  totalCurrent: number;
  totalLongTerm: number;
  operatingLeaseCount: number;
  operatingLeaseTotalCommitment: number;
  operatingLeaseMonthlyTotal: number;
  // Balance Sheet — current / non-current classification
  deferredRentAsset: number;
  deferredRentLiability: number;
  leaseIncentiveLiability: number;
  leaseIncentiveCurrent: number;
  leaseIncentiveNonCurrent: number;
  // Statement of Operations — P&L impact
  totalInterestExpense: number;
  totalStraightLineRentExpense: number;
  totalLeaseInducementAmortization: number;
  // Cash Flows — cash impact
  totalLoanProceeds: number;
  totalPrincipalRepaid: number;
  totalLoanPrincipalRepaid: number;
  totalCapitalLeasePrincipalRepaid: number;
  totalInterestPaid: number;
  totalOperatingLeaseCash: number;
  // Lease inducements received during the year, split by cash vs non-cash
  cashInducementsReceived: number;
  nonCashInducementsReceived: number;
}

// Engagement-level presentation uses the canonical FileSummary above; the
// builder lives separately so export dependencies never enter accounting code.
export { buildDisclosureModel, DisclosureEvidenceError } from "./disclosure-model";
export type {
  DisclosureModel,
  BuildDisclosureModelInput,
  DisclosureAgreementInput,
  DisclosureComparativeInput,
} from "./disclosure-model";

/**
 * Build the reporting population for a file without assuming that a manually
 * linked predecessor belongs to that same file. Only predecessors referenced
 * by the file's agreements are added, and every successor receives the full
 * predecessor record needed by transition schedules and workpaper evidence.
 */
export function hydrateLinkedAgreementPredecessors<
  T extends { id: string; predecessorAgreementId?: string | null },
>(
  agreements: readonly T[],
  predecessorCandidates: readonly T[],
): Array<T & { predecessorAgreement: T | null }> {
  const allById = new Map<string, T>();
  for (const item of predecessorCandidates) allById.set(item.id, item);
  for (const item of agreements) allById.set(item.id, item);

  const hydrateNode = (node: T, visited: Set<string>): T & { predecessorAgreement: T | null } => {
    if (visited.has(node.id)) return { ...node, predecessorAgreement: null };
    visited.add(node.id);

    const pred = node.predecessorAgreementId ? allById.get(node.predecessorAgreementId) : null;
    return {
      ...node,
      predecessorAgreement: pred ? hydrateNode(pred, new Set(visited)) : null,
    };
  };

  const reachable = new Set<string>();
  const queue = agreements.map(a => a.id);
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || reachable.has(id)) continue;
    reachable.add(id);
    const node = allById.get(id);
    if (node?.predecessorAgreementId) {
      queue.push(node.predecessorAgreementId);
    }
  }

  const flatList: T[] = [];
  for (const id of reachable) {
    const node = allById.get(id);
    if (node) flatList.push(node);
  }

  return flatList.map((agreement) => hydrateNode(agreement, new Set()));
}

export function buildFileSummary(
  loans: Array<{
    id: string;
    name: string;
    counterparty?: string | null;
    principal: number | string;
    downPayment?: number | string | null;
    interestRate: number | string;
    amortizationYears: number;
    termYears: number;
    startDate: string;
    ioMonths?: number | null;
    specificIoMonths?: string | null;
    balloonPayment?: number | string | null;
    paymentFrequency?: string | null;
    isCapitalLease?: boolean | null;
    monthlyPayment?: number | string | null;
    paymentOverride?: number | string | null;
    firstPaymentAmount?: number | string | null;
    graceMonths?: number | null;
    graceInterestTreatment?: string | null;
    termMonths?: number | null;
    freeRentMonths?: number | null;
    rentEscalationRate?: number | string | null;
    rentSteps?: Array<{ fromYear: number; toYear: number; monthlyRent: number }> | null;
    tenantImprovementAllowance?: number | string | null;
    otherInducements?: number | string | null;
    inducementReceivedInCash?: boolean | null;
    fvDecision?: string | null;
    fvRate?: number | string | null;
    rateType?: BookedScheduleInput["rateType"];
    ratePaymentTreatment?: BookedScheduleInput["ratePaymentTreatment"];
    initialFvRateAssumption?: Record<string, unknown> | null;
    activeEvents?: BookedScheduleInput["activeEvents"];
    activeRateEvents?: readonly unknown[] | null;
    activeEventSetId?: string | null;
    activeEventSetVersion?: number | null;
    activeEventSetHash?: string | null;
    covenantViolation?: boolean | null;
    predecessorAgreementId?: string | null;
    modificationEffectiveDate?: string | null;
    modificationAssessment?: AgreementModificationAssessment | null;
  }>,
  fyEndDate: string
): FileSummary {
  if (!fyEndDate) {
    return {
      loans: [],
      capitalLeases: [],
      operatingLeases: [],
      loanTotal: 0,
      leaseTotal: 0,
      loanCurrent: 0,
      loanLongTerm: 0,
      leaseCurrent: 0,
      leaseLongTerm: 0,
      totalDebt: 0,
      totalCurrent: 0,
      totalLongTerm: 0,
      operatingLeaseCount: 0,
      operatingLeaseTotalCommitment: 0,
      operatingLeaseMonthlyTotal: 0,
      deferredRentAsset: 0,
      deferredRentLiability: 0,
      leaseIncentiveLiability: 0,
      leaseIncentiveCurrent: 0,
      leaseIncentiveNonCurrent: 0,
      totalInterestExpense: 0,
      totalStraightLineRentExpense: 0,
      totalLeaseInducementAmortization: 0,
      totalLoanProceeds: 0,
      totalPrincipalRepaid: 0,
      totalLoanPrincipalRepaid: 0,
      totalCapitalLeasePrincipalRepaid: 0,
      totalInterestPaid: 0,
      totalOperatingLeaseCash: 0,
      cashInducementsReceived: 0,
      nonCashInducementsReceived: 0,
    };
  }
  const reportYearEnd = parseISO(fyEndDate);

  const loanSummaries: LoanSummary[] = [];
  const capitalLeaseSummaries: CapitalLeaseSummary[] = [];
  const operatingLeaseSummaries: OperatingLeaseSummary[] = [];

  let loanTotal = 0;
  let leaseTotal = 0;
  let loanCurrent = 0;
  let loanLongTerm = 0;
  let leaseCurrent = 0;
  let leaseLongTerm = 0;
  let operatingLeaseCount = 0;
  let operatingLeaseTotalCommitment = 0;
  let operatingLeaseMonthlyTotal = 0;

  // Financial statement aggregates
  let deferredRentAsset = 0;
  let deferredRentLiability = 0;
  let leaseIncentiveLiability = 0;
  let leaseIncentiveCurrent = 0;
  let leaseIncentiveNonCurrent = 0;
  let totalInterestExpense = 0;
  let totalStraightLineRentExpense = 0;
  let totalLeaseInducementAmortization = 0;
  let totalLoanProceeds = 0;
  let totalPrincipalRepaid = 0;
  let totalLoanPrincipalRepaid = 0;
  let totalCapitalLeasePrincipalRepaid = 0;
  let totalInterestPaid = 0;
  let totalOperatingLeaseCash = 0;
  let cashInducementsReceived = 0;
  let nonCashInducementsReceived = 0;

  const fy = reportYearEnd.getFullYear();
  // Reporting fiscal year window: the 12 months ending on the FY-end date.
  const fyWindowStart = new Date(fy - 1, reportYearEnd.getMonth(), reportYearEnd.getDate());

  const byId = new Map(loans.map((loan) => [loan.id, loan]));
  const linkedPredecessors = new Set(
    loans
      .filter((loan) => loan.modificationAssessment?.status === "confirmed")
      .map((loan) => loan.predecessorAgreementId)
      .filter((id): id is string => !!id),
  );
  for (const loan of loans) {
    // A confirmed successor presents the linked agreements as one accounting
    // timeline. Suppress the standalone predecessor to avoid double counting.
    if (linkedPredecessors.has(loan.id)) continue;
    const predecessor = loan.predecessorAgreementId ? byId.get(loan.predecessorAgreementId) : undefined;
    const summary = buildLoanSummary(
      { ...loan, predecessorAgreement: predecessor as BookedScheduleInput | undefined },
      reportYearEnd,
      fyEndDate,
    );
    if (!summary) continue;

    if ("monthlyPayment" in summary && "termMonths" in summary) {
      // Operating lease
      const op = summary as OperatingLeaseSummary;
      operatingLeaseSummaries.push(op);
      operatingLeaseCount++;
      operatingLeaseTotalCommitment += op.totalCommitment;
      operatingLeaseMonthlyTotal += op.monthlyPayment;
      leaseIncentiveLiability += op.inducementLiabilityCurrent + op.inducementLiabilityNonCurrent;
      leaseIncentiveCurrent += op.inducementLiabilityCurrent;
      leaseIncentiveNonCurrent += op.inducementLiabilityNonCurrent;
      // Straight-line rent expense for current fiscal year
      const slAmount = op.yearlyStraightLine.find((y) => y.fiscalYear === fy)?.amount ?? 0;
      totalStraightLineRentExpense += slAmount;
      // Cash payments for current fiscal year (actual cash, not straight-line expense)
      const cashAmount = op.yearlyCash.find((y) => y.fiscalYear === fy)?.amount ?? 0;
      totalOperatingLeaseCash += cashAmount;
      // Deferred rent classification
      if (op.deferredRentAtYearEnd < 0) deferredRentAsset += Math.abs(op.deferredRentAtYearEnd);
      else deferredRentLiability += op.deferredRentAtYearEnd;
      // Inducements received during the reporting fiscal year (lease originated this FY),
      // split into cash (financing inflow) vs non-cash (supplementary disclosure).
      const leaseStart = parseISO(loan.startDate);
      if (isAfter(leaseStart, fyWindowStart) && !isAfter(leaseStart, reportYearEnd)) {
        const grossInducement =
          Number(loan.tenantImprovementAllowance ?? 0) + Number(loan.otherInducements ?? 0);
        if (grossInducement > 0) {
          if (loan.inducementReceivedInCash) cashInducementsReceived += grossInducement;
          else nonCashInducementsReceived += grossInducement;
        }
      }
    } else if ("obligations" in summary) {
      // Capital lease
      const cl = summary as CapitalLeaseSummary;
      capitalLeaseSummaries.push(cl);
      leaseTotal += cl.balanceAtYearEnd;
      leaseCurrent += cl.currentPortion;
      leaseLongTerm += cl.longTermPortion;
      // Interest expense for current fiscal year
      const interestAmount = cl.yearlyInterest.find((y) => y.fiscalYear === fy)?.amount ?? 0;
      totalInterestExpense += interestAmount;
      // Principal + interest cash for current year
      totalPrincipalRepaid += cl.principalRepaidCurrentFY;
      totalCapitalLeasePrincipalRepaid += cl.principalRepaidCurrentFY;
      totalInterestPaid += interestAmount;
    } else {
      // Regular loan
      const l = summary as LoanSummary;
      loanSummaries.push(l);
      loanTotal += l.balanceAtYearEnd;
      loanCurrent += l.currentPortion;
      loanLongTerm += l.longTermPortion;
      // Interest expense for current fiscal year
      const interestAmount = l.yearlyInterest.find((y) => y.fiscalYear === fy)?.amount ?? 0;
      totalInterestExpense += interestAmount;
      // Principal + interest cash for current year
      totalPrincipalRepaid += l.principalRepaidCurrentFY;
      totalLoanPrincipalRepaid += l.principalRepaidCurrentFY;
      totalInterestPaid += interestAmount;
      // Loan proceeds: principal received if the loan originated during the reporting fiscal year
      const loanStart = parseISO(loan.startDate);
      if (isAfter(loanStart, fyWindowStart) && !isAfter(loanStart, reportYearEnd)) {
        // Cash actually received from the lender is net of any down payment.
        totalLoanProceeds += Number(loan.principal) - Number(loan.downPayment ?? 0);
      }
    }
  }

  return {
    loans: loanSummaries,
    capitalLeases: capitalLeaseSummaries,
    operatingLeases: operatingLeaseSummaries,
    loanTotal,
    leaseTotal,
    loanCurrent,
    loanLongTerm,
    leaseCurrent,
    leaseLongTerm,
    totalDebt: loanTotal + leaseTotal,
    totalCurrent: loanCurrent + leaseCurrent,
    totalLongTerm: loanLongTerm + leaseLongTerm,
    operatingLeaseCount,
    operatingLeaseTotalCommitment,
    operatingLeaseMonthlyTotal,
    deferredRentAsset,
    deferredRentLiability,
    leaseIncentiveLiability,
    leaseIncentiveCurrent,
    leaseIncentiveNonCurrent,
    totalInterestExpense,
    totalStraightLineRentExpense,
    totalLeaseInducementAmortization,
    totalLoanProceeds,
    totalPrincipalRepaid,
    totalLoanPrincipalRepaid,
    totalCapitalLeasePrincipalRepaid,
    totalInterestPaid,
    totalOperatingLeaseCash,
    cashInducementsReceived,
    nonCashInducementsReceived,
  };
}
