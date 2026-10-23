import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, filesTable, fvDecisionConfirmationsTable, loanEventsTable, loansTable, type FvDecisionConfirmation, type Loan } from "@workspace/db";
import {
  computeFvAdjustment,
  suggestFvDecision,
  type PrincipalPaymentEvent,
} from "@workspace/amortization";
import { logger } from "./logger";
import { fetchPrimeObservation } from "./prime-rates";

export const FV_EVIDENCE_VERSION = "1";

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const fingerprint = (value: unknown) =>
  createHash("sha256").update(stableJson(value)).digest("hex");

export class FvDecisionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type FvConfirmationInput = {
  expectedVersion: number;
  treatment: "use_fv" | "trivial" | "immaterial";
  marketEffectiveRate?: number | null;
  rationaleNote?: string | null;
  confirmedBy: string;
};

/** The only permitted source for the legacy loan scalar projection. */
export const confirmedFvProjection = (confirmation: Pick<
  FvDecisionConfirmation,
  "treatment" | "marketEffectiveRate" | "rationaleNote"
>) => ({
  fvDecision: confirmation.treatment,
  fvRate: confirmation.treatment === "use_fv" ? confirmation.marketEffectiveRate : null,
  fvDecisionNote: confirmation.rationaleNote,
});

export const isDirectFvProjectionWrite = (body: unknown): boolean =>
  !!body &&
  typeof body === "object" &&
  ["fvDecision", "fvRate", "fvDecisionNote"].some((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );

type FvContext = {
  loan: Loan;
  file: typeof filesTable.$inferSelect;
  modificationFingerprint: string | null;
  reportingFingerprint: string;
};

export const contextFor = (loan: Loan, file: typeof filesTable.$inferSelect): FvContext => {
  const modificationFingerprint = loan.modificationAssessment
    ? fingerprint(loan.modificationAssessment)
    : null;
  return {
    loan,
    file,
    modificationFingerprint,
    reportingFingerprint: fingerprint({
      fileId: file.id,
      fiscalYearEnd: file.fiscalYearEnd,
      trivialThreshold: file.trivialThreshold,
      materiality: file.materiality,
    }),
  };
};

export function validateFvConfirmation(loan: Loan, input: FvConfirmationInput) {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new FvDecisionError("expectedVersion must be a non-negative integer");
  }
  if (!input.confirmedBy.trim()) throw new FvDecisionError("confirmedBy is required");
  if (input.treatment === "use_fv") {
    if (input.marketEffectiveRate == null || !Number.isFinite(input.marketEffectiveRate) || input.marketEffectiveRate <= 0) {
      throw new FvDecisionError("use_fv requires a finite marketEffectiveRate greater than zero");
    }
    if (
      loan.rateType === "prime_linked" &&
      (!loan.initialFvRateAssumption ||
        loan.initialFvRateAssumption.approved !== true)
    ) {
      throw new FvDecisionError(
        "use_fv on a prime-linked loan requires an approved frozen day-one assumption",
      );
    }
  } else if (!input.rationaleNote?.trim()) {
    throw new FvDecisionError(`${input.treatment} requires a rationaleNote`);
  }
}

export async function confirmFvDecision(loanId: string, input: FvConfirmationInput) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from loans where id = ${loanId} for update`);
    const [loan] = await tx.select().from(loansTable).where(
      and(eq(loansTable.id, loanId), isNull(loansTable.deletedAt)),
    );
    if (!loan) throw new FvDecisionError("Loan not found", 404);
    validateFvConfirmation(loan, input);
    if (!loan.currentRevisionId || !loan.currentRevisionHash || !loan.calculationVersion) {
      throw new FvDecisionError("Loan contractual evidence has not been versioned", 409);
    }
    const [file] = await tx.select().from(filesTable).where(eq(filesTable.id, loan.fileId));
    if (!file) throw new FvDecisionError("Reporting file not found", 404);
    const [latest] = await tx.select().from(fvDecisionConfirmationsTable)
      .where(eq(fvDecisionConfirmationsTable.loanId, loanId))
      .orderBy(desc(fvDecisionConfirmationsTable.version)).limit(1);
    const currentVersion = latest?.version ?? 0;
    if (currentVersion !== input.expectedVersion) {
      throw new FvDecisionError(
        `FV decision version conflict: expected ${input.expectedVersion}, current version is ${currentVersion}`,
        409,
      );
    }
    const context = contextFor(loan, file);
    const evidence = {
      contractualCashFlowVersion: loan.calculationVersion,
      contractualCashFlowFingerprint: loan.currentRevisionHash,
      eventSet: {
        id: loan.activeEventSetId,
        version: loan.activeEventSetVersion,
        hash: loan.activeEventSetHash,
      },
      termRevision: { id: loan.currentRevisionId, hash: loan.currentRevisionHash },
      modificationAssessment: {
        identity: context.modificationFingerprint,
        conclusion: loan.modificationAssessment?.conclusion.accountingTreatment ?? null,
      },
      paymentTiming: loan.paymentTiming,
      frozenPrimeLinkedDayOneAssumption:
        loan.rateType === "prime_linked" ? loan.initialFvRateAssumption : null,
      contractualRate: Number(loan.interestRate),
      marketEffectiveRate: input.treatment === "use_fv" ? input.marketEffectiveRate! : null,
      reportingContext: {
        fileId: file.id,
        fiscalYearEnd: file.fiscalYearEnd,
        trivialThreshold: file.trivialThreshold,
        materiality: file.materiality,
      },
      calculationVersion: loan.calculationVersion,
      evidenceVersion: FV_EVIDENCE_VERSION,
      inputs: {
        treatment: input.treatment,
        marketEffectiveRate: input.marketEffectiveRate ?? null,
        rationaleNote: input.rationaleNote?.trim() || null,
        contractRevisionId: loan.currentRevisionId,
        contractFingerprint: loan.currentRevisionHash,
        eventSetId: loan.activeEventSetId,
        eventSetVersion: loan.activeEventSetVersion,
        eventSetFingerprint: loan.activeEventSetHash,
        modificationFingerprint: context.modificationFingerprint,
        reportingContextFingerprint: context.reportingFingerprint,
      },
    };
    const canonicalFingerprint = fingerprint(evidence);
    const [confirmation] = await tx.insert(fvDecisionConfirmationsTable).values({
      loanId,
      sourceConfirmationId: null,
      inheritedFromLoanId: null,
      sourceFileId: null,
      version: currentVersion + 1,
      treatment: input.treatment,
      marketEffectiveRate: input.treatment === "use_fv" ? String(input.marketEffectiveRate) : null,
      rationaleNote: input.rationaleNote?.trim() || null,
      confirmedBy: input.confirmedBy.trim(),
      canonicalFingerprint,
      contractFingerprint: loan.currentRevisionHash,
      eventSetFingerprint: loan.activeEventSetHash,
      reportingContextFingerprint: context.reportingFingerprint,
      modificationFingerprint: context.modificationFingerprint,
      evidenceVersion: FV_EVIDENCE_VERSION,
      calculationVersion: loan.calculationVersion,
      evidence,
    }).returning();
    // Compatibility projection only. The immutable confirmation above is the
    // authoritative decision and is never updated.
    await tx.update(loansTable).set(confirmedFvProjection(confirmation))
      .where(eq(loansTable.id, loanId));
    return confirmation;
  });
}

export function deriveFvReviewStatus(
  context: FvContext,
  current: FvDecisionConfirmation | null,
) {
  if (!current) {
    const missing: string[] = [];
    if (!context.loan.fvDecision) missing.push("treatment");
    if (context.loan.fvDecision === "use_fv" && !(Number(context.loan.fvRate) > 0)) missing.push("marketEffectiveRate");
    if ((context.loan.fvDecision === "trivial" || context.loan.fvDecision === "immaterial") && !context.loan.fvDecisionNote?.trim()) missing.push("rationaleNote");
    if (
      context.loan.fvDecision === "use_fv" &&
      context.loan.rateType === "prime_linked" &&
      context.loan.initialFvRateAssumption?.approved !== true
    ) missing.push("approvedFrozenPrimeAssumption");
    return { status: "incomplete" as const, reviewRequired: true, staleReasons: [], missingRequirements: missing.length ? missing : ["confirmation"], current: null };
  }
  const staleReasons: string[] = [];
  if (current.sourceConfirmationId) staleReasons.push("inherited_historical_evidence");
  const expectedProjection = confirmedFvProjection(current);
  if (
    context.loan.fvDecision !== expectedProjection.fvDecision ||
    (expectedProjection.fvRate == null
      ? context.loan.fvRate != null
      : Number(context.loan.fvRate) !== Number(expectedProjection.fvRate)) ||
    context.loan.fvDecisionNote !== expectedProjection.fvDecisionNote
  ) staleReasons.push("compatibility_projection_mismatch");
  if (
    current.contractFingerprint !== context.loan.currentRevisionHash ||
    current.evidence.termRevision.id !== context.loan.currentRevisionId
  ) staleReasons.push("contract_terms_changed");
  // Deterministic conservative policy: every immutable event-set successor,
  // including an ordinary realized prime reset, requires review. It does not
  // alter the frozen assumption captured in prior evidence.
  if (
    current.eventSetFingerprint !== context.loan.activeEventSetHash ||
    current.evidence.eventSet.id !== context.loan.activeEventSetId ||
    current.evidence.eventSet.version !== context.loan.activeEventSetVersion
  ) staleReasons.push("event_or_rate_history_changed");
  if (current.reportingContextFingerprint !== context.reportingFingerprint) staleReasons.push("reporting_context_changed");
  if (current.modificationFingerprint !== context.modificationFingerprint) staleReasons.push("modification_assessment_changed");
  return {
    status: staleReasons.length ? "stale" as const : "current" as const,
    reviewRequired: staleReasons.length > 0,
    staleReasons,
    missingRequirements: [],
    current,
  };
}

export async function getFvDecisionHistory(loanId: string) {
  const [loan] = await db.select().from(loansTable).where(
    and(eq(loansTable.id, loanId), isNull(loansTable.deletedAt)),
  );
  if (!loan) throw new FvDecisionError("Loan not found", 404);
  const [file] = await db.select().from(filesTable).where(eq(filesTable.id, loan.fileId));
  if (!file) throw new FvDecisionError("Reporting file not found", 404);
  const history = await db.select().from(fvDecisionConfirmationsTable)
    .where(eq(fvDecisionConfirmationsTable.loanId, loanId))
    .orderBy(desc(fvDecisionConfirmationsTable.version));
  return { ...deriveFvReviewStatus(contextFor(loan, file), history[0] ?? null), history };
}

/* ------------------------------------------------------------------ */
/*  Prime-rate helper (Bank of Canada Valet API)                     */
/* ------------------------------------------------------------------ */

export async function fetchPrimeRate(dateStr: string): Promise<{ primeRate: number; source: string }> {
  // The series has no future observations; clamp to today.
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr > today) dateStr = today;

  try {
    const observation = await fetchPrimeObservation(dateStr);
    return { primeRate: observation.rate, source: "Bank of Canada V80691311" };
  } catch (err) {
    logger.warn({ err, date: dateStr }, "Failed to fetch BoC prime rate; falling back to 7.20%");
    // Conservative fallback (historical range ~3-8%)
    return { primeRate: 7.2, source: "Fallback default" };
  }
}

/* ------------------------------------------------------------------ */
/*  FV decision auto-suggestion                                       */
/* ------------------------------------------------------------------ */

export interface FvEvalLoanInput {
  interestRate: string;
  principal: string;
  downPayment?: string | null;
  amortizationYears: number;
  termYears: number;
  startDate: string;
  ioMonths: number;
  specificIoMonths: string;
  graceMonths?: number;
  graceInterestTreatment?: string;
  balloonPayment: string;
  paymentFrequency: string;
  paymentTiming: string;
  graceTermMode: string;
  firstPaymentDate?: string | null;
  semiMonthlyFirstDueDay?: number | null;
  semiMonthlySecondDueDay?: number | null;
  fvRate?: string | null;
  paymentOverride?: string | null;
  firstPaymentAmount?: string | null;
  principalEvents?: PrincipalPaymentEvent[];
}

export interface FvEvalFileInput {
  trivialThreshold?: string | null;
  materiality?: string | null;
}

/**
 * Compares the computed FV adjustment against the file's trivialThreshold and
 * materiality to auto-suggest a treatment decision. Returns null when the
 * loan isn't below-market-rate or when the file has no thresholds configured.
 */
export async function computeFvSuggestion(
  loan: FvEvalLoanInput,
  file: FvEvalFileInput
): Promise<{ fvDecision: "use_fv" | "trivial" | "immaterial"; fvRate: number } | null> {
  const rate = Number(loan.interestRate);
  const isBelowMarketRate = rate > 0 && rate < 3;
  if (!isBelowMarketRate) return null;

  const startDateObj = new Date(loan.startDate);
  let fvRate = loan.fvRate != null ? Number(loan.fvRate) : undefined;
  // Non-finite saved rates (NaN/Infinity from a malformed value) must never
  // drive the FV math — fall back to prime + 2%.
  if (fvRate == null || !Number.isFinite(fvRate) || fvRate <= 0) {
    const dateStr = startDateObj.toISOString().split("T")[0];
    const { primeRate } = await fetchPrimeRate(dateStr);
    fvRate = Number((primeRate + 2).toFixed(2));
  }

  const fvAdjustment = computeFvAdjustment({
    principal: Number(loan.principal) - Number(loan.downPayment ?? 0),
    contractualRate: rate,
    fvRate,
    amortizationYears: loan.amortizationYears,
    termYears: loan.termYears,
    startDate: startDateObj,
    ioMonths: loan.ioMonths,
    specificIoMonths: loan.specificIoMonths
      ? loan.specificIoMonths.split(",").map(Number).filter((n) => !isNaN(n))
      : [],
    balloonPayment: Number(loan.balloonPayment),
    frequency: loan.paymentFrequency as "monthly" | "semi-monthly" | "bi-weekly" | "weekly",
    paymentOverride: loan.paymentOverride != null ? Number(loan.paymentOverride) : null,
    graceMonths: loan.graceMonths ?? 0,
    graceInterestTreatment: loan.graceInterestTreatment === "none" ? "none" : "capitalized",
    paymentTiming: loan.paymentTiming === "beginning" ? "beginning" : "end",
    graceTermMode: loan.graceTermMode === "added" ? "added" : "included",
    firstPaymentDate: loan.firstPaymentDate
      ? new Date(`${loan.firstPaymentDate}T00:00:00Z`)
      : undefined,
    semiMonthlyDueDays:
      loan.semiMonthlyFirstDueDay != null && loan.semiMonthlySecondDueDay != null
        ? [loan.semiMonthlyFirstDueDay, loan.semiMonthlySecondDueDay]
        : undefined,
  }, {
    principalEvents: loan.principalEvents,
    commencementDate: startDateObj,
    firstPaymentAmount: loan.firstPaymentAmount != null ? Number(loan.firstPaymentAmount) : null,
  });

  const trivialThreshold = file.trivialThreshold != null ? Number(file.trivialThreshold) : null;
  const materiality = file.materiality != null ? Number(file.materiality) : null;

  const decision = suggestFvDecision(fvAdjustment, trivialThreshold, materiality);
  if (!decision) return null;

  return { fvDecision: decision, fvRate };
}

/**
 * Re-evaluates the auto-suggested FV decision for every below-market-rate
 * loan in a file after its trivialThreshold or materiality changes. Only
 * touches only loans with no saved decision. A saved decision is treated as
 * an accountant-selected policy and is never silently replaced by a bulk
 * threshold refresh.
 */
export async function evaluateFvDecisionsForFile(
  fileId: string,
  file: FvEvalFileInput,
  loanIds?: readonly string[],
): Promise<void> {
  const loans = await db
    .select()
    .from(loansTable)
    .where(and(eq(loansTable.fileId, fileId), isNull(loansTable.deletedAt)));
  const activeSetIds = loans
    .map((loan) => loan.activeEventSetId)
    .filter((id): id is string => id != null);
  const events = activeSetIds.length
    ? await db
        .select()
        .from(loanEventsTable)
        .where(inArray(loanEventsTable.setId, activeSetIds))
    : [];

  for (const loan of loans) {
    if (loanIds && !loanIds.includes(loan.id)) continue;
    if (loan.fvDecision != null) continue;

    await db.transaction(async (tx) => {
      // Re-read under a row lock so an accountant decision saved after the
      // initial list query cannot be overwritten by this bulk operation.
      const [current] = await tx
        .select()
        .from(loansTable)
        .where(
          and(
            eq(loansTable.id, loan.id),
            isNull(loansTable.deletedAt),
            isNull(loansTable.fvDecision),
          ),
        )
        .for("update");
      if (!current) return;

      const suggestion = await computeFvSuggestion(
        {
          interestRate: current.interestRate,
          principal: current.principal,
          downPayment: current.downPayment,
          amortizationYears: current.amortizationYears,
          termYears: current.termYears,
          startDate: current.startDate,
          ioMonths: current.ioMonths,
          specificIoMonths: current.specificIoMonths,
          graceMonths: current.graceMonths,
          graceInterestTreatment: current.graceInterestTreatment,
          balloonPayment: current.balloonPayment,
          paymentFrequency: current.paymentFrequency,
          paymentTiming: current.paymentTiming,
          graceTermMode: current.graceTermMode,
          firstPaymentDate: current.firstPaymentDate,
          semiMonthlyFirstDueDay: current.semiMonthlyFirstDueDay,
          semiMonthlySecondDueDay: current.semiMonthlySecondDueDay,
          fvRate: current.fvRate,
          paymentOverride: current.paymentOverride,
          firstPaymentAmount: current.firstPaymentAmount,
          principalEvents: (current.activeEventSetId
            ? events.filter(
                (event) =>
                  event.loanId === current.id && event.setId === current.activeEventSetId,
              )
            : []
          )
            .sort(
              (a, b) =>
                a.effectiveDate.localeCompare(b.effectiveDate) ||
                (a.ordering === "before_scheduled_payment" ? 0 : 1) -
                  (b.ordering === "before_scheduled_payment" ? 0 : 1) ||
                a.sequence - b.sequence,
            )
            .map((event) => ({
              id: event.id,
              effectiveDate: new Date(`${event.effectiveDate}T00:00:00Z`),
              ordering: event.ordering as PrincipalPaymentEvent["ordering"],
              sequence: event.sequence,
              amount: Number(event.amount),
              treatment: event.treatment as PrincipalPaymentEvent["treatment"],
            })),
        },
        file,
      );
      if (!suggestion) return;

       await tx
        .update(loansTable)
        .set({
          fvRate: suggestion.fvRate.toString(),
        })
        .where(
          and(
            eq(loansTable.id, current.id),
            isNull(loansTable.fvDecision),
          ),
        )
         .returning();
    });
  }
}
