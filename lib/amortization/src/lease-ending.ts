import { addMonths, format, parseISO } from "date-fns";

/** Explicit opt-in contract: absence MUST retain historical lease calculations. */
export type LeaseEndingKind = "mandatory_payment" | "guaranteed_residual" | "optional_purchase" | "bargain_purchase" | "lessor_residual" | "none" | "unresolved";
export interface LeaseEndingTerms {
  version: 1;
  kind: LeaseEndingKind;
  amount: number | null;
  basis: "stated" | "percentage" | "reserve" | "sum" | "unsupported";
  source: string;
  baseAmount?: number | null;
  percentage?: number | null;
  reserves?: Array<{ fromMonth: number; toMonth: number; monthlyAmount: number }>;
  sumAmounts?: number[];
  settlementMonth: number | null;
  /** Working lease-end timing follows term edits; a separate reviewer timing does not. */
  settlementMonthBasis?: "lease_end" | "separate";
  /** Opt-in on a newly completed assessment; absent preserves historical depreciation. */
  assetAmortizationPolicy?: "aspe_3065";
  issues: string[];
  status: "draft" | "reviewed";
  explanation?: string;
  suggestedTreatment?: {
    kind: Exclude<LeaseEndingKind, "unresolved" | "none">;
    reason: string;
    accepted: boolean;
  };
  commencement?: { date: string; basis: "stated" | "inferred"; source: string; confirmed: boolean };
  taxTreatment?: "recoverable" | "nonrecoverable" | "excluded" | "unresolved";
  servicesMonthly?: number;
  refundableDeposit?: number;
  incrementalBorrowingRate?: number | null;
  implicitRate?: number | null;
  /** Present only for a rate solved by this application, not a quoted contract rate. */
  implicitRateBasis?: "calculated";
  discountRate?: number | null;
  paymentComponentsApplied?: boolean;
  grossMonthlyPayment?: number;
  grossFirstPaymentAmount?: number;
  firstPaymentComponentsApplied?: boolean;
  taxRate?: number;
}

/** .17: ownership transfer/BPO uses economic life; otherwise use the lease term.
 * Legacy agreements retain their saved period until deliberately reassessed. */
export function leaseAssetAmortizationYears(loan: {
  isCapitalLease?: boolean | null; transferOfOwnership?: boolean | null;
  bargainPurchaseOption?: boolean | null; assetUsefulLife?: number | null;
  termMonths?: number | null; termYears?: number | null; leaseEndingTerms?: unknown;
}): number {
  const ending = loan.leaseEndingTerms as LeaseEndingTerms | undefined | null;
  if (!loan.isCapitalLease || ending?.assetAmortizationPolicy !== "aspe_3065" ||
      loan.transferOfOwnership || loan.bargainPurchaseOption) return loan.assetUsefulLife ?? 0;
  return (loan.termMonths ?? (loan.termYears ?? 0) * 12) / 12;
}

/** Only draft/default timing follows a term correction. Preserve separately
 * entered timing and historical reviewed evidence unless explicitly opted in. */
export function updateLeaseSettlementForTerm(value: LeaseEndingTerms, previousMonths: number, months: number): LeaseEndingTerms {
  const followsTerm = value.settlementMonthBasis === "lease_end" ||
    (value.settlementMonthBasis !== "separate" && value.status !== "reviewed" &&
      (value.settlementMonth == null || previousMonths <= 0 || value.settlementMonth === previousMonths));
  const valid = Number.isInteger(months) && months > 0;
  return { ...value, status: "draft",
    ...(followsTerm ? { settlementMonth: valid ? months : null, settlementMonthBasis: "lease_end" as const }
      : value.settlementMonthBasis ? {} : { settlementMonthBasis: "separate" as const }),
    issues: value.issues.filter(issue =>
      !(valid && issue === "A positive whole-month lease term is required.") &&
      !(valid && followsTerm && issue === "Confirm settlement timing at or after the final rental period.")),
  };
}

const nonnegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const cents = (n: number) => Math.round(n * 100) / 100;

// Recompute machine-generated validation messages after edits. Preserve all
// documentary/reviewer concerns; fixing a field must not require staff to
// manually delete an obsolete machine warning from the evidence textbox.
const validationMessages = {
  version: "Unsupported ending-term version.",
  term: "A positive whole-month lease term is required.",
  source: "Source clauses or reviewer evidence are required.",
  kind: "Ending obligation remains unresolved.",
  suggestion: "Confirm the suggested ending treatment or choose a different treatment.",
  unsupported: "Formula requires professional review; no amount was guessed.",
  sum: "A sum requires documented, non-negative amounts in the same currency, without alternative or duplicated settlements.",
  percentage: "Percentage requires a supported base and a percentage from 0 to 100.",
  reserve: "Reserve periods must cover the full term once, with valid monthly amounts not exceeding cost.",
  amount: "Ending amount is missing or invalid.",
  zero: "No obligation requires an explicitly supported zero amount.",
  settlement: "Confirm settlement timing at or after the final rental period.",
  commencement: "Confirm inferred commencement against delivery or commencement evidence.",
  tax: "Resolve recoverable taxes, non-recoverable taxes and services separately.",
  taxRate: "The rental is marked as including recoverable tax. Enter the included tax rate, or choose Payments exclude taxes if the entered rental is before tax.",
  services: "Service amount must be non-negative.",
  deposit: "Refundable deposit must be non-negative.",
} as const;
const machineValidationMessages = new Set<string>(Object.values(validationMessages));

/** AI supplies operands and operative clauses; only this function supplies arithmetic. */
export function normalizeLeaseEnding(input: LeaseEndingTerms, termMonths: number): LeaseEndingTerms {
  const result: LeaseEndingTerms = { ...input, taxTreatment: input.taxTreatment ?? "unresolved", issues: (input.issues ?? []).filter(message => !machineValidationMessages.has(message)) };
  const issue = (message: string) => { if (!result.issues.includes(message)) result.issues.push(message); };
  if (input.version !== 1) issue(validationMessages.version);
  if (!Number.isInteger(termMonths) || termMonths <= 0) issue(validationMessages.term);
  if (!input.source?.trim()) issue(validationMessages.source);
  if (input.kind === "unresolved") issue(validationMessages.kind);
  if (input.suggestedTreatment && input.kind === input.suggestedTreatment.kind && !input.suggestedTreatment.accepted) {
    issue(validationMessages.suggestion);
  }
  if (input.basis === "unsupported") {
    result.amount = null;
    issue(validationMessages.unsupported);
  } else if (input.basis === "sum") {
    if (!input.sumAmounts?.length || !input.sumAmounts.every(nonnegative)) {
      result.amount = null;
      issue(validationMessages.sum);
    } else {
      result.amount = cents(input.sumAmounts.reduce((sum, n) => sum + n, 0));
      result.explanation = `${input.sumAmounts.join(" + ")} = ${result.amount}`;
    }
  } else if (input.basis === "percentage") {
    if (!nonnegative(input.baseAmount) || !nonnegative(input.percentage) || input.percentage > 100) {
      result.amount = null;
      issue(validationMessages.percentage);
    } else {
      result.amount = cents(input.baseAmount * input.percentage / 100);
      result.explanation = `${input.baseAmount} × ${input.percentage}% = ${result.amount}`;
    }
  } else if (input.basis === "reserve") {
    const blocks = [...(input.reserves ?? [])].sort((a, b) => a.fromMonth - b.fromMonth);
    let next = 1, total = 0;
    let valid = nonnegative(input.baseAmount) && blocks.length > 0;
    for (const block of blocks) {
      if (!Number.isInteger(block.fromMonth) || !Number.isInteger(block.toMonth) ||
          block.fromMonth !== next || block.toMonth < block.fromMonth ||
          block.toMonth > termMonths || !nonnegative(block.monthlyAmount)) valid = false;
      total += (block.toMonth - block.fromMonth + 1) * block.monthlyAmount;
      next = block.toMonth + 1;
    }
    if (!valid || next !== termMonths + 1 || total > (input.baseAmount ?? 0)) {
      result.amount = null;
      issue(validationMessages.reserve);
    } else {
      result.amount = cents(input.baseAmount! - total);
      result.explanation = `${input.baseAmount} − reserves ${cents(total)} = ${result.amount}.${input.kind === "unresolved" ? " Confirm the ending obligation from the agreement or a documented assessment." : ""}`;
    }
  }
  if (!nonnegative(result.amount)) issue(validationMessages.amount);
  if (input.kind === "none" && result.amount !== 0) issue(validationMessages.zero);
  if (!Number.isInteger(input.settlementMonth) || input.settlementMonth! < termMonths) issue(validationMessages.settlement);
  if (input.commencement?.basis === "inferred" && !input.commencement.confirmed) issue(validationMessages.commencement);
  if (result.taxTreatment === "unresolved") issue(validationMessages.tax);
  if (input.taxTreatment === "recoverable" && (!nonnegative(input.taxRate) || input.taxRate === 0)) issue(validationMessages.taxRate);
  if (input.servicesMonthly != null && !nonnegative(input.servicesMonthly)) issue(validationMessages.services);
  if (input.refundableDeposit != null && !nonnegative(input.refundableDeposit)) issue(validationMessages.deposit);
  if (result.issues.length) result.status = "draft";
  return result;
}

export function leaseEndingTreatmentLabel(kind: LeaseEndingKind): string {
  return {
    guaranteed_residual: "Client covers a loss when the asset is sold",
    mandatory_payment: "Client must make a final payment",
    optional_purchase: "Client may choose to buy the asset",
    bargain_purchase: "Client has a bargain purchase option",
    lessor_residual: "The leasing company keeps the ending-value risk",
    none: "No final payment or loss guarantee",
    unresolved: "Not yet confirmed",
  }[kind];
}

/** Adopting a suggestion records a reviewer assumption, not a discovered clause. */
export function acceptSuggestedLeaseTreatment(value: LeaseEndingTerms): LeaseEndingTerms {
  const suggestion = value.suggestedTreatment;
  if (!suggestion || !suggestion.reason.trim() || (value.kind !== "unresolved" && value.kind !== suggestion.kind)) return value;
  return {
    ...value,
    kind: suggestion.kind,
    suggestedTreatment: { ...suggestion, accepted: true },
    status: "draft",
    source: `${value.source}\nReviewer accepted an inferred treatment: ${leaseEndingTreatmentLabel(suggestion.kind)}. Basis: ${suggestion.reason}`,
    issues: value.issues.filter(issue => issue !== "Ending obligation remains unresolved." &&
      issue !== "Confirm the suggested ending treatment or choose a different treatment."),
  };
}

export function lesseeEndingAmount(terms: LeaseEndingTerms): number {
  if (terms.issues.length || !nonnegative(terms.amount) || terms.kind === "unresolved") {
    throw new Error("Resolve lease ending terms before calculating accounting outputs.");
  }
  return ["mandatory_payment", "guaranteed_residual", "bargain_purchase"].includes(terms.kind) ? terms.amount : 0;
}

export interface LeaseCashFlows {
  monthlyPayment: number;
  termMonths: number;
  paymentAtBeginning: boolean;
  downPayment: number;
  firstPaymentAmount?: number | null;
  ending: LeaseEndingTerms;
}

/** Fail closed for calendars/timelines the explicit monthly engine cannot represent. */
export function leaseScheduleSupportIssue(loan: {
  startDate?: string | Date | null; firstPaymentDate?: string | Date | null;
  paymentTiming?: string | null; rateType?: string | null;
  activeEvents?: readonly unknown[] | null; initialEvents?: readonly unknown[] | null;
  rateTimelineEvents?: readonly unknown[] | null; activeRateEvents?: readonly unknown[] | null;
}): string | null {
  if (loan.rateType === "prime_linked" || loan.activeEvents?.length || loan.initialEvents?.length ||
      loan.rateTimelineEvents?.length || loan.activeRateEvents?.length) {
    return "Dated prepayments and rate resets require the event-aware accounting path. Keep ending terms in draft; existing events cannot be discarded.";
  }
  if (loan.firstPaymentDate) {
    const start = loan.startDate instanceof Date ? loan.startDate : parseISO(loan.startDate ?? "");
    const first = loan.firstPaymentDate instanceof Date ? loan.firstPaymentDate : parseISO(loan.firstPaymentDate);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(first.getTime()) ||
        format(first, "yyyy-MM-dd") !== format(addMonths(start, loan.paymentTiming === "beginning" ? 0 : 1), "yyyy-MM-dd")) {
      return "The contractual first-payment date is not a standard commencement-anchored monthly date. Keep ending terms in draft until this calendar is supported.";
    }
  }
  return null;
}

export function lastLeaseRentalDate(startDate: Date, firstPaymentDate: Date | null, termMonths: number, atBeginning: boolean): Date {
  const first = firstPaymentDate ?? addMonths(startDate, atBeginning ? 0 : 1);
  return addMonths(first, Math.max(0, termMonths - 1));
}

/** The rental stream only. No purchase option, guarantee, residual or other terminal amount. */
export function leaseRentalPresentValue(a: Omit<LeaseCashFlows, "ending">, annualRate: number): number {
  if (!nonnegative(annualRate) || !nonnegative(a.monthlyPayment) || !nonnegative(a.downPayment) ||
      !Number.isInteger(a.termMonths) || a.termMonths <= 0 ||
      (a.firstPaymentAmount != null && !nonnegative(a.firstPaymentAmount))) throw new Error("Invalid lease cash flows.");
  const r = annualRate / 1200;
  let pv = a.downPayment;
  for (let i = 0; i < a.termMonths; i++) {
    const payment = i === 0 ? a.firstPaymentAmount ?? a.monthlyPayment : a.monthlyPayment;
    pv += payment / (1 + r) ** (i + (a.paymentAtBeginning ? 0 : 1));
  }
  return pv;
}

export function leasePresentValue(a: LeaseCashFlows, annualRate: number, forImplicitRate = false): number {
  const pv = leaseRentalPresentValue(a, annualRate);
  const end = lesseeEndingAmount(a.ending);
  const residual = forImplicitRate && a.ending.kind === "lessor_residual" ? a.ending.amount! : end;
  return pv + residual / (1 + annualRate / 1200) ** a.ending.settlementMonth!;
}

/** Returns null, never a confident zero, when the supported cash flows have no nonnegative solution. */
export function leaseImplicitRate(a: LeaseCashFlows, fairValue: number): number | null {
  if (!nonnegative(fairValue) || fairValue <= a.downPayment) return null;
  const zeroPV = leasePresentValue(a, 0, true);
  if (zeroPV < fairValue) return null;
  if (Math.abs(zeroPV - fairValue) < 1e-9) return 0;
  let lo = 0, hi = 100;
  while (leasePresentValue(a, hi, true) > fairValue && hi < 1e6) hi *= 2;
  if (leasePresentValue(a, hi, true) > fairValue) return null;
  for (let i = 0; i < 160; i++) {
    const mid = (lo + hi) / 2;
    if (leasePresentValue(a, mid, true) > fairValue) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function inferLeaseCommencement(expiry: string, months: number): LeaseEndingTerms["commencement"] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isInteger(months) || months <= 0) return null;
  const date = new Date(`${expiry}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== expiry) return null;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return { date: date.toISOString().slice(0, 10), basis: "inferred", source: `Expiry ${expiry} minus ${months} months; not a delivery date.`, confirmed: false };
}
