import { z } from "zod";
import { assessLeaseClassification, calculateLeaseSchedule, leaseScheduleSupportIssue, leasePresentValue, lesseeEndingAmount, normalizeLeaseEnding, type LeaseEndingTerms, type LeaseClassificationInput } from "@workspace/amortization";

/** Approval is separate from measurement; apply to operating and capital leases alike. */
export function validateLeaseClassification(loan: LeaseClassificationInput, ending: LeaseEndingTerms) {
  if (ending.status === "reviewed") {
    const result = assessLeaseClassification({ ...loan, leaseEndingTerms: ending });
    if (result.status === "needs_review") throw new Error(result.rationale);
    if ((result.status === "capital") !== !!loan.isCapitalLease) {
      throw new Error(`Classification conflicts with reviewed evidence. ${result.rationale} Reopen the assessment and explicitly reconfirm; the application has not changed your decision.`);
    }
  }
  // Explicit operating evidence must persist as an operating lease, including
  // drafts. A rate-only PATCH can invalidate review, but must not turn it into
  // a loan. Assessment/discount rates are evidence, not contractual interest.
  if (!loan.isCapitalLease) {
    if (loan.interestRate == null || Number(loan.interestRate) !== 0) {
      throw new Error("Operating leases require interestRate to be zero. Preserve the supported assessment rate separately in leaseAssessmentRate or the lease ending discount-rate evidence.");
    }
    if (loan.monthlyPayment == null || loan.termMonths == null) {
      throw new Error("Operating leases require monthlyPayment and termMonths so the saved agreement remains an operating lease.");
    }
  }
}

export const leaseEndingSchema = z.object({
  version: z.literal(1),
  kind: z.enum(["mandatory_payment", "guaranteed_residual", "optional_purchase", "bargain_purchase", "lessor_residual", "none", "unresolved"]),
  amount: z.number().finite().nonnegative().nullable(),
  basis: z.enum(["stated", "percentage", "reserve", "sum", "unsupported"]),
  sumAmounts: z.array(z.number().finite().nonnegative()).optional(),
  source: z.string(),
  baseAmount: z.number().finite().nonnegative().nullable().optional(),
  percentage: z.number().finite().min(0).max(100).nullable().optional(),
  reserves: z.array(z.object({
    fromMonth: z.number().int().positive(),
    toMonth: z.number().int().positive(),
    monthlyAmount: z.number().finite().nonnegative(),
  })).optional(),
  settlementMonth: z.number().int().nonnegative().nullable(),
  issues: z.array(z.string()),
  status: z.enum(["draft", "reviewed"]),
  explanation: z.string().optional(),
  suggestedTreatment: z.object({
    kind: z.enum(["mandatory_payment", "guaranteed_residual", "optional_purchase", "bargain_purchase", "lessor_residual"]),
    reason: z.string().trim().min(1).max(1200),
    accepted: z.boolean().default(false),
  }).optional().catch(undefined),
  commencement: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    basis: z.enum(["stated", "inferred"]),
    source: z.string(),
    confirmed: z.boolean(),
  }).optional(),
  taxTreatment: z.enum(["recoverable", "nonrecoverable", "excluded", "unresolved"]).optional(),
  servicesMonthly: z.number().finite().nonnegative().optional(),
  refundableDeposit: z.number().finite().nonnegative().optional(),
  incrementalBorrowingRate: z.number().finite().nonnegative().nullable().optional(),
  implicitRate: z.number().finite().nonnegative().nullable().optional(),
  discountRate: z.number().finite().nonnegative().nullable().optional(),
  paymentComponentsApplied: z.boolean().optional(),
  grossMonthlyPayment: z.number().finite().nonnegative().optional(),
  grossFirstPaymentAmount: z.number().finite().nonnegative().optional(),
  firstPaymentComponentsApplied: z.boolean().optional(),
  taxRate: z.number().finite().nonnegative().optional(),
});

export function validateLeaseEnding(value: unknown, months: number): LeaseEndingTerms {
  const parsed = leaseEndingSchema.parse(value);
  const result = normalizeLeaseEnding(parsed, months);
  if (parsed.status === "reviewed" && result.issues.length) {
    throw new Error(`Cannot mark lease reviewed: ${result.issues.join(" ")}`);
  }
  return result;
}

export function unresolvedLeaseEnding(reason: string, months: number | null): LeaseEndingTerms {
  return { version: 1, kind: "unresolved", amount: null, basis: "unsupported", source: "",
    settlementMonth: months, issues: [reason], status: "draft" };
}

/** Server-owned financial projections prevent independently edited balloons/rates drifting. */
export function leaseAccountingProjection(loan: Record<string, unknown>, ending: LeaseEndingTerms): Record<string, unknown> {
  if (ending.status !== "reviewed" || !loan.isCapitalLease) return {};
  const supportIssue = leaseScheduleSupportIssue(loan);
  if (supportIssue) throw new Error(supportIssue);
  const months = Number(loan.termMonths ?? Number(loan.termYears) * 12);
  const gross = ending.grossMonthlyPayment ?? Number(loan.paymentOverride ?? loan.monthlyPayment);
  const rawPayment = ending.paymentComponentsApplied ? Number(loan.paymentOverride ?? loan.monthlyPayment)
    : (ending.taxTreatment === "recoverable" && ending.taxRate ? gross / (1 + ending.taxRate / 100) : gross) - (ending.servicesMonthly ?? 0);
  // PV and the reopened schedule must use precisely the same persisted cents.
  const payment = Math.round(rawPayment * 100) / 100;
  const downPayment = Math.round(Number(loan.downPayment ?? 0) * 100) / 100;
  const fairValue = Math.round(Number(loan.fairValue) * 100) / 100;
  const rate = ending.incrementalBorrowingRate != null && ending.implicitRate != null
    ? Math.min(ending.incrementalBorrowingRate, ending.implicitRate)
    : ending.incrementalBorrowingRate ?? ending.implicitRate ?? ending.discountRate ?? Number(loan.interestRate);
  if (!Number.isFinite(fairValue) || fairValue <= 0) throw new Error("Review requires a supported positive fair value.");
  if (loan.paymentFrequency !== "monthly" || Number(loan.graceMonths ?? 0) || Number(loan.ioMonths ?? 0)) {
    throw new Error("Explicit lease ending calculations currently require monthly rentals without grace or interest-only periods; keep unsupported structures in draft.");
  }
  const grossFirstPayment = loan.firstPaymentAmount == null ? null : ending.grossFirstPaymentAmount ?? Number(loan.firstPaymentAmount);
  const firstPaymentAmount = grossFirstPayment == null ? null : Math.round(100 * (
    ending.firstPaymentComponentsApplied ? Number(loan.firstPaymentAmount)
      : (ending.taxTreatment === "recoverable" && ending.taxRate ? grossFirstPayment / (1 + ending.taxRate / 100) : grossFirstPayment) - (ending.servicesMonthly ?? 0)
  )) / 100;
  if (firstPaymentAmount != null && firstPaymentAmount <= 0) throw new Error("First financing installment must be positive after tax and service deductions.");
  const pv = leasePresentValue({ monthlyPayment: payment, downPayment, termMonths: months,
    paymentAtBeginning: loan.paymentTiming === "beginning", firstPaymentAmount, ending }, rate);
  if (!(payment > 0) || downPayment >= Math.min(pv, fairValue)) throw new Error("Verify rentals and down payment before marking reviewed.");
  const principal = Number(Math.min(pv, fairValue).toFixed(2));
  calculateLeaseSchedule({ monthlyPayment: payment, downPayment, termMonths: months,
    paymentAtBeginning: loan.paymentTiming === "beginning", firstPaymentAmount, ending,
    annualRate: rate, openingAmount: principal - downPayment,
    startDate: loan.startDate instanceof Date ? loan.startDate : new Date(`${String(loan.startDate).slice(0, 10)}T00:00:00Z`),
  });
  return {
    principal: Math.min(pv, fairValue).toFixed(2), assetCost: Math.min(pv, fairValue).toFixed(2),
    balloonPayment: lesseeEndingAmount(ending).toFixed(2),
    // Measurement owns the opening balances, not the earlier assessment percentage.
    interestRate: rate.toString(),
    monthlyPayment: payment.toFixed(2),
    paymentOverride: payment.toFixed(2),
    downPayment: downPayment.toFixed(2),
    firstPaymentAmount: firstPaymentAmount == null ? null : firstPaymentAmount.toFixed(2),
    leaseEndingTerms: { ...ending, discountRate: rate, grossMonthlyPayment: gross, paymentComponentsApplied: true,
      ...(grossFirstPayment == null ? {} : { grossFirstPaymentAmount: grossFirstPayment, firstPaymentComponentsApplied: true }) },
  };
}
