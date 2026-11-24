import { leaseRentalPresentValue, normalizeLeaseEnding, type LeaseEndingTerms } from "./lease-ending";

type Numeric = string | number | null;
export interface LeaseClassificationInput {
  isCapitalLease?: boolean | null;
  transferOfOwnership?: boolean | null;
  bargainPurchaseOption?: boolean | null;
  specializedAsset?: boolean | null;
  leaseTermPct?: Numeric;
  assetUsefulLife?: number | null;
  termMonths?: number | null;
  monthlyPayment?: Numeric;
  paymentOverride?: Numeric;
  firstPaymentAmount?: Numeric;
  downPayment?: Numeric;
  fairValue?: Numeric;
  interestRate?: Numeric;
  leaseAssessmentRate?: Numeric;
  paymentTiming?: string | null;
  leaseEndingTerms?: unknown;
}

/** Classification support, never the opening asset or liability. No stored PV percentage is evidence. */
export function assessLeaseClassification(a: LeaseClassificationInput) {
  const issues: string[] = [];
  const reasons: string[] = [];
  const months = Number(a.termMonths);
  const raw = a.leaseEndingTerms as LeaseEndingTerms | null | undefined;
  const ending = raw ? normalizeLeaseEnding(raw, months) : null;
  if (!ending) issues.push("Ending evidence is unavailable. Historical classification is retained; review the agreement before reconfirming.");
  else {
    issues.push(...ending.issues);
    if (ending.status !== "reviewed") issues.push("Review the ending treatment, amount and supporting clauses.");
    if (a.bargainPurchaseOption === true && ending.kind !== "bargain_purchase") {
      issues.push("The bargain-purchase answer conflicts with the ending treatment. Review the purchase clause and expected value at exercise; a shortfall guarantee is not a purchase.");
    }
    if (a.bargainPurchaseOption !== true && ending.kind === "bargain_purchase") {
      issues.push(`The ending terms identify a bargain purchase but the assessment ${a.bargainPurchaseOption === false ? "says No" : "answer is unavailable"}. Resolve both answers against the agreement.`);
    }
  }
  const rateValue = ending?.implicitRate != null && ending.incrementalBorrowingRate != null
    ? Math.min(ending.implicitRate, ending.incrementalBorrowingRate)
    : ending?.incrementalBorrowingRate ?? ending?.implicitRate ?? ending?.discountRate ?? a.leaseAssessmentRate ?? a.interestRate;
  const rate = rateValue == null ? NaN : Number(rateValue);
  const fairValue = Number(a.fairValue);
  const gross = Number(a.paymentOverride ?? a.monthlyPayment);
  const net = (value: number) => Math.round(100 * (
    (ending?.taxTreatment === "recoverable" && Number(ending.taxRate) > 0 ? value / (1 + Number(ending.taxRate) / 100) : value)
    - (ending?.servicesMonthly ?? 0))) / 100;
  const payment = ending && !ending.paymentComponentsApplied ? net(ending.grossMonthlyPayment ?? gross) : gross;
  const first = a.firstPaymentAmount == null ? null : ending && !ending.firstPaymentComponentsApplied
    ? net(ending.grossFirstPaymentAmount ?? Number(a.firstPaymentAmount)) : Number(a.firstPaymentAmount);
  let rental: { pv: number; percent: number; meets: boolean } | null = null;
  if (fairValue > 0 && payment > 0 && Number.isFinite(rate) && rate >= 0 &&
      (rate > 0 || [ending?.implicitRate, ending?.incrementalBorrowingRate, ending?.discountRate].includes(0))) {
    try {
      const pv = leaseRentalPresentValue({ monthlyPayment: payment, firstPaymentAmount: first,
        termMonths: months, downPayment: Number(a.downPayment ?? 0), paymentAtBeginning: a.paymentTiming === "beginning" }, rate);
      const percent = pv / fairValue * 100;
      rental = { pv, percent, meets: percent >= 90 };
    } catch { /* Missing evidence is not a failed test. */ }
  }
  const required = rental && ending?.status === "reviewed" && !ending.issues.length &&
    ["mandatory_payment", "guaranteed_residual", "bargain_purchase"].includes(ending.kind)
    ? (() => {
      const pv = rental.pv + ending.amount! / (1 + rate / 1200) ** ending.settlementMonth!;
      return { pv, percent: pv / fairValue * 100, meets: pv >= fairValue * 0.9 };
    })() : null;
  // ASPE .03(r), .06(c): the formal comparison includes qualifying terminal
  // obligations. Rent alone is supplementary, never a substitute for MLP.
  const minimum = rental && ending?.status === "reviewed" && !ending.issues.length
    ? required ?? (["none", "optional_purchase", "lessor_residual"].includes(ending.kind) ? rental : null)
    : null;
  const payments = minimum && ending ? {
    rentals: leaseRentalPresentValue({ monthlyPayment: payment, firstPaymentAmount: first,
      termMonths: months, downPayment: Number(a.downPayment ?? 0), paymentAtBeginning: a.paymentTiming === "beginning" }, 0),
    ending: required ? ending.amount! : 0,
  } : null;
  const lifePercent = Number(a.assetUsefulLife) > 0 && months > 0
    ? months / (Number(a.assetUsefulLife) * 12) * 100
    : Number(a.leaseTermPct) > 0 ? Number(a.leaseTermPct) : null;
  if (a.transferOfOwnership) reasons.push("Transfer of ownership");
  if (a.bargainPurchaseOption) reasons.push("Bargain purchase option — separate assessment basis");
  if (lifePercent != null && lifePercent >= 75) reasons.push("Lease term >= 75% of useful life");
  if (minimum?.meets) reasons.push("Minimum lease payments meet the 90% guideline");
  if (!reasons.length) {
    if (!minimum) issues.push("Minimum lease payment comparison unavailable: verify rentals, ending terms, fair value, timing and discount rate.");
    if (lifePercent == null) issues.push("Useful-life comparison unavailable: verify the term and economic life.");
    if (a.transferOfOwnership == null || a.bargainPurchaseOption == null) issues.push("Confirm ownership and bargain-purchase answers.");
    if (a.specializedAsset) issues.push("Specialized use requires a documented risks-and-rewards review; it is not a separate bright-line test.");
  }
  const status = issues.length ? "needs_review" : reasons.length ? "capital" : "operating";
  const rationale = status === "needs_review" ? `Needs review — ${[...new Set(issues)].join(" ")}`
    : status === "capital" ? `Under ASPE 3065, capital lease classification is supported by: ${reasons.join("; ")}.`
    : "Under ASPE 3065, the reviewed evidence supports operating lease classification; no capital classification basis is met.";
  return { status, reasons, issues: [...new Set(issues)], rental, required, minimum, payments, lifePercent, rationale } as const;
}
