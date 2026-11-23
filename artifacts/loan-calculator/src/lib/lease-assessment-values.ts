import { assessLeaseClassification, leaseRentalPresentValue, leasePresentValue, normalizeLeaseEnding, type LeaseEndingTerms } from "@workspace/amortization";
import type { AssessmentAnswers, AssessmentResult } from "../components/capital-lease-assessment";
import { calculateStraightLineLease } from "./straight-line";

/** Shared by create preview/save and re-evaluation. Normalization is idempotent
 * for confirmed answers, so documentary gross inputs are never deducted twice. */
export function calculateOperatingLeaseAssessment(
  result: Pick<AssessmentResult, "answers" | "straightLine">,
  startDate: string,
  fiscalYearEnd: string,
) {
  const answers = normalizedAssessmentAnswers(result.answers);
  const sl = result.straightLine;
  return calculateStraightLineLease({
    baseMonthlyRent: answers.monthlyPayment,
    firstPaymentAmount: answers.firstPaymentAmount,
    termMonths: answers.termMonths,
    freeRentMonths: sl?.freeRentMonths ?? 0,
    escalationRate: sl?.rentEscalationRate ?? 0,
    rentSteps: sl?.rentSteps,
    tenantImprovementAllowance: sl?.tenantImprovementAllowance ?? 0,
    otherInducements: sl?.otherInducements ?? 0,
    startDate,
    fiscalYearEnd,
  });
}

export function assessmentRate(a: AssessmentAnswers) {
  const e = a.leaseEndingTerms;
  if (e?.implicitRate != null && e.incrementalBorrowingRate != null) return Math.min(e.implicitRate, e.incrementalBorrowingRate);
  return e?.incrementalBorrowingRate ?? e?.implicitRate ?? e?.discountRate ?? a.interestRate;
}

export const percentLabel = (value: number) => (value < 90 && value >= 89.95) ? "<90" : value.toFixed(1);

export function assessmentConclusion(a: AssessmentAnswers) {
  const n = normalizedAssessmentAnswers(a);
  return assessLeaseClassification({ ...n, assetUsefulLife: a.economicLife,
    leaseTermPct: a.economicLife > 0 && a.termMonths > 0 ? a.termMonths / (a.economicLife * 12) * 100 : null,
    paymentTiming: a.paymentAtBeginning ? "beginning" : "end" });
}
export const savedLeaseConclusion = assessLeaseClassification;

/** Confirmation is local to this exact evidence; changed reasons alone are not sufficient. */
export const assessmentConfirmationKey = (a: AssessmentAnswers) => JSON.stringify(normalizedAssessmentAnswers(a));

/** Classification support only; by design the shared rental function takes no ending amount. */
export function rentalAssessment(a: AssessmentAnswers) {
  const rate = assessmentRate(a);
  if (!(a.fairValue > 0 && a.monthlyPayment > 0 && a.termMonths > 0) ||
      !(rate > 0 || (rate === 0 && [a.leaseEndingTerms?.implicitRate, a.leaseEndingTerms?.incrementalBorrowingRate, a.leaseEndingTerms?.discountRate].includes(0)))) return null;
  try {
    const pv = leaseRentalPresentValue({ monthlyPayment: preTaxMonthlyPayment(a), firstPaymentAmount: financingFirstPayment(a), termMonths: a.termMonths, downPayment: a.downPayment, paymentAtBeginning: a.paymentAtBeginning }, rate);
    const percent = pv / a.fairValue * 100;
    return { pv, percent, meets: percent >= 90 };
  } catch { return null; }
}

/** When rent alone is insufficient, do not silently classify a documented mandatory payment
 * or guarantee as optional. This is a classification check, not an opening book value. */
export function meetsRequiredEndingTest(a: AssessmentAnswers, rent: ReturnType<typeof rentalAssessment>) {
  const e = a.leaseEndingTerms;
  if (!rent || rent.meets || !e || !["mandatory_payment", "guaranteed_residual"].includes(e.kind)) return false;
  const t = normalizeLeaseEnding(e, a.termMonths);
  if (t.status !== "reviewed" || t.issues.length || t.amount == null || t.settlementMonth == null) return false;
  return rent.pv + t.amount / (1 + assessmentRate(a) / 1200) ** t.settlementMonth >= 0.9 * a.fairValue;
}

/** Use the persisted payment basis to show the same rental comparison on a reopened lease.
 * Older inclusive assessment percentages are never relabelled as rent-only. */
export function savedRentalAssessment(loan: { leaseAssessmentRate?: unknown; leaseEndingTerms?: unknown; monthlyPayment?: unknown; paymentOverride?: unknown; fairValue?: unknown; termMonths?: number | null; downPayment?: unknown; interestRate?: unknown; paymentTiming?: string | null; firstPaymentAmount?: unknown }) {
  return rentalAssessment({ monthlyPayment: Number(loan.paymentOverride ?? loan.monthlyPayment), fairValue: Number(loan.fairValue), termMonths: Number(loan.termMonths), downPayment: Number(loan.downPayment ?? 0), interestRate: Number(loan.leaseAssessmentRate ?? loan.interestRate), paymentAtBeginning: loan.paymentTiming === "beginning", firstPaymentAmount: loan.firstPaymentAmount == null ? null : Number(loan.firstPaymentAmount), leaseEndingTerms: loan.leaseEndingTerms as LeaseEndingTerms | null, paymentIncludesTax: false, taxRate: 0 } as AssessmentAnswers);
}

/** Normalize once at the wizard boundary, retaining gross documentary evidence. */
export function normalizedAssessmentAnswers(a: AssessmentAnswers): AssessmentAnswers {
  const ending = a.leaseEndingTerms;
  const rate = assessmentRate(a);
  return { ...a, interestRate: rate, monthlyPayment: preTaxMonthlyPayment(a),
    firstPaymentAmount: financingFirstPayment(a), paymentIncludesTax: false,
    ...(ending ? { leaseEndingTerms: { ...ending, discountRate: rate, paymentComponentsApplied: true,
      grossMonthlyPayment: ending.grossMonthlyPayment ?? a.monthlyPayment,
      taxRate: ending.taxRate ?? a.taxRate,
      ...(a.firstPaymentAmount == null ? {} : {
        grossFirstPaymentAmount: ending.grossFirstPaymentAmount ?? a.firstPaymentAmount,
        firstPaymentComponentsApplied: true,
      }),
    } } : {}),
  };
}

/** Reopen documented gross inputs for editing; never deduct from saved net inputs again. */
export function assessmentAnswersForReview(a: AssessmentAnswers): AssessmentAnswers {
  const ending = a.leaseEndingTerms;
  if (!ending) return a;
  // A draft edited in the financing form can retain older gross evidence.
  // Only restore that evidence when it still reconciles to the saved amount.
  const useGrossMonthly = ending.grossMonthlyPayment != null && (!ending.paymentComponentsApplied ||
    Math.abs(preTaxMonthlyPayment({ ...a, leaseEndingTerms: { ...ending, paymentComponentsApplied: false } }) - a.monthlyPayment) < 0.005);
  const useGrossFirst = ending.grossFirstPaymentAmount != null && (!ending.firstPaymentComponentsApplied ||
    Math.abs((financingFirstPayment({ ...a, leaseEndingTerms: { ...ending, firstPaymentComponentsApplied: false } }) ?? 0) - (a.firstPaymentAmount ?? 0)) < 0.005);
  return { ...a,
    monthlyPayment: useGrossMonthly ? ending.grossMonthlyPayment! : a.monthlyPayment,
    firstPaymentAmount: a.firstPaymentAmount == null ? null : useGrossFirst ? ending.grossFirstPaymentAmount! : a.firstPaymentAmount,
    leaseEndingTerms: { ...ending,
      paymentComponentsApplied: useGrossMonthly ? false : ending.paymentComponentsApplied,
      firstPaymentComponentsApplied: useGrossFirst ? false : ending.firstPaymentComponentsApplied,
    },
  };
}

/** Operating classification keeps its historical zero contractual-rate sentinel. */
export function assessmentPaymentSaveValues(a: AssessmentAnswers, isCapitalLease: boolean) {
  const normalized = normalizedAssessmentAnswers(a);
  return {
    interestRate: isCapitalLease ? normalized.interestRate : 0,
    leaseAssessmentRate: normalized.interestRate,
    monthlyPayment: normalized.monthlyPayment,
    paymentOverride: normalized.monthlyPayment,
    firstPaymentAmount: normalized.firstPaymentAmount ?? null,
    leaseEndingTerms: normalized.leaseEndingTerms ? { ...normalized.leaseEndingTerms } : undefined,
  };
}

/** Minimum lease payments must exclude executory costs like sales tax
 * (ASPE 3065). When the entered payment includes GST/HST/PST, strip it
 * before discounting. */
export function preTaxMonthlyPayment(a: AssessmentAnswers): number {
  if (a.leaseEndingTerms) {
    if (a.leaseEndingTerms.paymentComponentsApplied) return a.monthlyPayment;
    const services = a.leaseEndingTerms.servicesMonthly ?? 0;
    const gross = a.leaseEndingTerms.grossMonthlyPayment ?? a.monthlyPayment;
    const taxRate = a.leaseEndingTerms.taxRate ?? a.taxRate;
    const payment = a.leaseEndingTerms.taxTreatment === "recoverable" && taxRate > 0
      ? gross / (1 + taxRate / 100) : gross;
    return Math.round(Math.max(0, payment - services) * 100) / 100;
  }
  if (a.paymentIncludesTax && a.taxRate > 0) {
    return Math.round(a.monthlyPayment / (1 + a.taxRate / 100) * 100) / 100;
  }
  return a.monthlyPayment;
}

export function financingFirstPayment(a: AssessmentAnswers): number | null {
  if (a.firstPaymentAmount == null) return null;
  const ending = a.leaseEndingTerms;
  if (!ending) return a.paymentIncludesTax && a.taxRate > 0 ? Math.round(a.firstPaymentAmount / (1 + a.taxRate / 100) * 100) / 100 : a.firstPaymentAmount;
  if (ending.firstPaymentComponentsApplied) return a.firstPaymentAmount;
  const gross = ending.grossFirstPaymentAmount ?? a.firstPaymentAmount;
  const rate = ending.taxRate ?? a.taxRate;
  return Math.round(100 * ((ending.taxTreatment === "recoverable" && rate > 0 ? gross / (1 + rate / 100) : gross) - (ending.servicesMonthly ?? 0))) / 100;
}

export function calculatePVFromAnswers(a: AssessmentAnswers): number {
  if (a.leaseEndingTerms) {
    try {
      const ending = normalizeLeaseEnding(a.leaseEndingTerms, a.termMonths);
      const rate = assessmentRate(a);
      return Math.round(leasePresentValue({ ...a, monthlyPayment: preTaxMonthlyPayment(a), firstPaymentAmount: financingFirstPayment(a), ending }, rate) * 100) / 100;
    } catch { return 0; } // Draft values are not an accounting conclusion.
  }
  try {
    return Math.round(leaseRentalPresentValue({ ...a, monthlyPayment: preTaxMonthlyPayment(a),
      firstPaymentAmount: financingFirstPayment(a) }, assessmentRate(a)) * 100) / 100;
  } catch { return 0; }
}

