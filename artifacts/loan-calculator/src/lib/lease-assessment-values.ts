import { assessLeaseClassification, leaseRentalPresentValue, leasePresentValue, leaseImplicitRate, normalizeLeaseEnding, updateLeaseSettlementForTerm, type LeaseEndingTerms } from "@workspace/amortization";
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

export function assessmentRate(a: Pick<AssessmentAnswers, "interestRate" | "leaseEndingTerms">) {
  const e = a.leaseEndingTerms;
  if (e?.implicitRate != null && e.incrementalBorrowingRate != null) return Math.min(e.implicitRate, e.incrementalBorrowingRate);
  return e?.incrementalBorrowingRate ?? e?.implicitRate ?? e?.discountRate ?? a.interestRate;
}

export function changeAssessmentTerm(a: AssessmentAnswers, months: number): AssessmentAnswers {
  return { ...a, termMonths: months,
    leaseTermPct: months > 0 && a.economicLife > 0 ? Math.round(months / (a.economicLife * 12) * 1000) / 10 : 0,
    ...(a.leaseEndingTerms ? { leaseEndingTerms: updateLeaseSettlementForTerm(a.leaseEndingTerms, a.termMonths, months) } : {}),
  };
}

/** An implicit lease rate is not the client's separately supported borrowing rate. */
export function applyCalculatedLeaseRate(a: AssessmentAnswers, rate: number): AssessmentAnswers {
  if (!Number.isFinite(rate) || rate <= 0) return a;
  if (!a.leaseEndingTerms) return { ...a, interestRate: rate };
  const ending = { ...a.leaseEndingTerms, implicitRate: rate, implicitRateBasis: "calculated" as const, status: "draft" as const,
    // Unknown imported/draft borrowing rates sometimes arrived as zero. They
    // must not override the positive rate the reviewer has just chosen.
    ...(a.leaseEndingTerms.incrementalBorrowingRate === 0 && a.leaseEndingTerms.status !== "reviewed"
      ? { incrementalBorrowingRate: null } : {}),
  };
  const selected = assessmentRate({ interestRate: rate, leaseEndingTerms: ending });
  return { ...a, interestRate: selected, leaseEndingTerms: { ...ending, discountRate: selected } };
}

/** Pricing can use an imported ending value before unrelated review questions
 * are resolved. This does not approve the ending obligation for accounting. */
export function leasePricingAssumption(a: AssessmentAnswers) {
  const ending = a.leaseEndingTerms ? normalizeLeaseEnding(a.leaseEndingTerms, a.termMonths) : null;
  const fromEnding = !!ending && ending.kind !== "optional_purchase" &&
    ending.amount != null && Number.isFinite(ending.amount) && ending.amount >= 0;
  const amount = fromEnding ? ending!.amount! : ending && !(a.buyoutForImplicitRate > 0) ? null : a.buyoutForImplicitRate;
  return {
    amount,
    settlementMonth: fromEnding ? ending!.settlementMonth ?? a.termMonths : a.termMonths,
    fromEnding,
    provisional: !!ending && (ending.status !== "reviewed" || ending.issues.length > 0),
  };
}

export function calculateAssessmentImplicitRate(a: AssessmentAnswers): number | null {
  const pricing = leasePricingAssumption(a);
  if (a.leaseEndingTerms?.taxTreatment === "recoverable" && !(Number(a.leaseEndingTerms.taxRate) > 0)) return null;
  if (Number(a.freeRentMonths ?? 0) > 0 || Number(a.rentEscalationRate ?? 0) !== 0 ||
      a.rentSteps?.some(step => Math.abs(step.monthlyRent - (a.leaseEndingTerms?.grossMonthlyPayment ?? a.monthlyPayment)) > 0.005)) return null;
  if (!(a.fairValue > 0 && a.monthlyPayment > 0 && a.termMonths > 0) ||
      pricing.amount == null || !Number.isFinite(pricing.amount) || pricing.amount < 0 ||
      !Number.isInteger(pricing.settlementMonth) || pricing.settlementMonth < a.termMonths) return null;
  try {
    return leaseImplicitRate({
      monthlyPayment: preTaxMonthlyPayment(a), firstPaymentAmount: financingFirstPayment(a),
      termMonths: a.termMonths, downPayment: a.downPayment, paymentAtBeginning: a.paymentAtBeginning,
      // This is pricing only: never change the saved obligation, review state
      // or missing clauses merely to solve a rate.
      ending: { version: 1, kind: "lessor_residual", amount: pricing.amount, basis: "stated",
        settlementMonth: pricing.settlementMonth, source: "Pricing assumption only", issues: [], status: "draft" },
    }, a.fairValue);
  } catch { return null; }
}

function pricingKey(a: AssessmentAnswers) {
  const p = leasePricingAssumption(a);
  return JSON.stringify([a.fairValue, preTaxMonthlyPayment(a), financingFirstPayment(a), a.termMonths,
    a.downPayment, a.paymentAtBeginning, p.amount, p.settlementMonth,
    a.leaseEndingTerms?.taxTreatment, a.leaseEndingTerms?.taxRate, a.rentSteps, a.freeRentMonths, a.rentEscalationRate]);
}

/** Reprice only application-calculated rates. Quoted rates and independent IBR evidence stay intact. */
export function reconcileCalculatedLeaseRate(previous: AssessmentAnswers, next: AssessmentAnswers): AssessmentAnswers {
  if (previous.leaseEndingTerms?.implicitRateBasis !== "calculated" ||
      next.leaseEndingTerms?.implicitRateBasis !== "calculated" || pricingKey(previous) === pricingKey(next)) return next;
  const rate = calculateAssessmentImplicitRate(next);
  if (rate != null && rate > 0) return applyCalculatedLeaseRate(next, rate);
  const borrowing = next.leaseEndingTerms.incrementalBorrowingRate;
  return { ...next, interestRate: borrowing ?? 0, leaseEndingTerms: {
    ...next.leaseEndingTerms, implicitRate: null, discountRate: borrowing ?? null, status: "draft",
  } };
}

/** A reviewed date must update both accounting calculations and the saved agreement. */
export function assessmentStartDate(a: AssessmentAnswers, fallback: string): string {
  return a.leaseEndingTerms?.commencement?.confirmed ? a.leaseEndingTerms.commencement.date : fallback;
}

/** An AI guess is a last-resort reference, never a competing selectable rate. */
export function leaseRateGuidance(a: AssessmentAnswers, estimate?: number | null) {
  const e = a.leaseEndingTerms;
  const explicitRate = [e?.implicitRate, e?.incrementalBorrowingRate].some(rate =>
    rate != null && Number.isFinite(rate) && rate >= 0);
  const selectedRate = [e?.discountRate, a.interestRate].some(rate =>
    rate != null && Number.isFinite(rate) && rate > 0);
  const calculatedRate = calculateAssessmentImplicitRate(a);
  const canCalculate = calculatedRate != null && Number.isFinite(calculatedRate) && calculatedRate >= 0;
  const showEstimate = !explicitRate && !selectedRate && !canCalculate &&
    estimate != null && Number.isFinite(estimate) && estimate > 0;
  const pricing = leasePricingAssumption(a);
  const reason = !(a.fairValue > 0) ? "The asset's fair value is missing."
    : !(a.monthlyPayment > 0) ? "The monthly rental is missing."
    : !(a.termMonths > 0) ? "The lease term is missing."
    : pricing.amount == null ? "A supported ending value is missing."
    : "The current payment, ending-value and timing inputs do not produce an implicit rate. Check these inputs first.";
  return { calculatedRate, showEstimate, reason };
}

export const percentLabel = (value: number) => (value < 90 && value >= 89.95) ? "<90" : value.toFixed(1);

export function leaseReviewIssueLabel(issue: string): string {
  if (issue === "Confirm inferred commencement against delivery or commencement evidence.") return "Confirm or correct the proposed start date below.";
  if (issue === "Resolve recoverable taxes, non-recoverable taxes and services separately.") return "Confirm whether the rental includes taxes or services in the review fields below.";
  if (issue === "Review the ending treatment, amount and supporting clauses.") return "Check the ending amount and clause, then tick the review confirmation below.";
  return issue;
}

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
    ...(ending ? { leaseEndingTerms: { ...ending, assetAmortizationPolicy: "aspe_3065" as const, discountRate: rate, paymentComponentsApplied: true,
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

