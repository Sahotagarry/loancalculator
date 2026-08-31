import {
  calculateAmortization,
  type PrincipalPaymentEvent,
  type RateResetEvent,
} from "@workspace/amortization";
import type { Loan, LoanEvent } from "@workspace/db";
type StoredEvent = Pick<
  LoanEvent,
  "id" | "effectiveDate" | "ordering" | "sequence" | "amount" | "treatment" | "kind" |
  "benchmarkRate" | "spread" | "resultingRate" | "source" | "observationDate" |
  "publishedDate" | "fetchedAt" | "sourceUrl" | "author" | "reason"
>;

const asDate = (value: string): Date =>
  new Date(`${value.split("T")[0]}T00:00:00Z`);

export function toPrincipalPaymentEvents(
  events: readonly StoredEvent[],
): PrincipalPaymentEvent[] {
  return events.filter((event) => event.kind === "principal_prepayment").map((event) => ({
    id: event.id,
    effectiveDate: asDate(event.effectiveDate),
    ordering: event.ordering as PrincipalPaymentEvent["ordering"],
    sequence: event.sequence,
    amount: Number(event.amount),
    treatment: event.treatment as PrincipalPaymentEvent["treatment"],
  }));
}

export function toRateResetEvents(events: readonly StoredEvent[]): RateResetEvent[] {
  return events.filter((event) => event.kind === "rate_reset").map((event) => ({
    id: event.id,
    effectiveDate: asDate(event.effectiveDate),
    ordering: event.ordering as RateResetEvent["ordering"],
    sequence: event.sequence,
    benchmarkRate: Number(event.benchmarkRate),
    spread: Number(event.spread),
    resultingContractualRate: Number(event.resultingRate),
    treatment: event.treatment as RateResetEvent["treatment"],
    sourceEvidence: {
      source: event.source,
      observationDate: event.observationDate ? asDate(event.observationDate) : undefined,
      publishedDate: event.publishedDate ? asDate(event.publishedDate) : undefined,
      fetchedAt: event.fetchedAt ?? undefined,
      reference: event.sourceUrl ?? undefined,
    },
    overrideEvidence: event.reason === "Contractual benchmark reset" ? undefined : {
      reason: event.reason, authoredAt: new Date(), author: event.author ?? undefined,
    },
  }));
}

/**
 * Returns whether an event-adjusted obligation remains after the source FYE.
 * A positive contractual residual remains outstanding even when its final
 * scheduled row is on/before FYE.
 */
export function isLoanOutstandingAt(
  loan: Loan,
  activeEvents: readonly StoredEvent[],
  sourceFiscalYearEnd: string,
): boolean {
  const startDate = asDate(loan.startDate);
  const fye = asDate(sourceFiscalYearEnd);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(fye.getTime())) {
    throw new Error(`Cannot determine roll-forward eligibility for loan ${loan.id}: invalid date`);
  }
  // A future agreement is not a source-year closing obligation.
  if (startDate.getTime() > fye.getTime()) return false;

  const result = calculateAmortization(
    Number(loan.principal) - Number(loan.downPayment),
    Number(loan.interestRate),
    loan.amortizationYears,
    loan.termMonths != null ? loan.termMonths / 12 : loan.termYears,
    startDate,
    loan.ioMonths,
    loan.specificIoMonths
      ? loan.specificIoMonths.split(",").map(Number).filter(Number.isFinite)
      : [],
    Number(loan.balloonPayment),
    loan.paymentFrequency as "monthly" | "semi-monthly" | "bi-weekly" | "weekly",
    loan.paymentOverride == null ? null : Number(loan.paymentOverride),
    loan.graceMonths,
    loan.graceInterestTreatment === "none" ? "none" : "capitalized",
    {
      paymentTiming: loan.paymentTiming === "beginning" ? "beginning" : "end",
      graceTermMode: loan.graceTermMode === "added" ? "added" : "included",
      firstPaymentDate: loan.firstPaymentDate ? asDate(loan.firstPaymentDate) : undefined,
      semiMonthlyDueDays:
        loan.semiMonthlyFirstDueDay != null && loan.semiMonthlySecondDueDay != null
          ? [loan.semiMonthlyFirstDueDay, loan.semiMonthlySecondDueDay]
          : undefined,
      principalEvents: toPrincipalPaymentEvents(activeEvents),
      rateResetEvents: toRateResetEvents(activeEvents),
      commencementDate: startDate,
    },
  );

  const final = result.schedule.at(-1);
  if (!final) return Number(loan.principal) - Number(loan.downPayment) > 0;
  const residual = Math.max(0, final.balance) +
    (final.rowType === "principal_event" ? Math.max(0, final.accruedInterest ?? 0) : 0);
  return residual > 0.005 || final.date.getTime() > fye.getTime();
}