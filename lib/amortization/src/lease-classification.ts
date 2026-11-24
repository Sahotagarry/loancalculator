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
  rentSteps?: unknown;
  freeRentMonths?: number | null;
  rentEscalationRate?: Numeric;
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
  const steps = Array.isArray(a.rentSteps) ? a.rentSteps : [];
  const unsupportedRent = Number(a.freeRentMonths ?? 0) > 0 || Number(a.rentEscalationRate ?? 0) !== 0 ||
    steps.some(step => !step || !Number.isFinite(Number(step.monthlyRent)) ||
      Math.abs(Number(step.monthlyRent) - (ending?.grossMonthlyPayment ?? gross)) > 0.005);
  const rentScheduleIssue = "This lease has stepped, escalating or rent-free rentals. The automatic capital-lease calculation currently supports level rentals only; review the full payment schedule before confirming classification.";
  if (unsupportedRent) issues.push(rentScheduleIssue);
  const net = (value: number) => Math.round(100 * (
    (ending?.taxTreatment === "recoverable" && Number(ending.taxRate) > 0 ? value / (1 + Number(ending.taxRate) / 100) : value)
    - (ending?.servicesMonthly ?? 0))) / 100;
  const payment = ending && !ending.paymentComponentsApplied ? net(ending.grossMonthlyPayment ?? gross) : gross;
  const first = a.firstPaymentAmount == null ? null : ending && !ending.firstPaymentComponentsApplied
    ? net(ending.grossFirstPaymentAmount ?? Number(a.firstPaymentAmount)) : Number(a.firstPaymentAmount);
  let rental: { pv: number; percent: number; meets: boolean } | null = null;
  if (!unsupportedRent && fairValue > 0 && payment > 0 && Number.isFinite(rate) && rate >= 0 &&
      (rate > 0 || [ending?.implicitRate, ending?.incrementalBorrowingRate, ending?.discountRate].includes(0))) {
    try {
      const pv = leaseRentalPresentValue({ monthlyPayment: payment, firstPaymentAmount: first,
        termMonths: months, downPayment: Number(a.downPayment ?? 0), paymentAtBeginning: a.paymentTiming === "beginning" }, rate);
      const percent = pv / fairValue * 100;
      rental = { pv, percent, meets: percent >= 90 };
    } catch { /* Missing evidence is not a failed test. */ }
  }
  // Show the arithmetic while staff review the evidence, without treating that
  // draft result as an approved classification basis.
  const comparisonInputsMissing: string[] = [];
  if (unsupportedRent) comparisonInputsMissing.push(rentScheduleIssue);
  if (!Number.isFinite(fairValue) || fairValue <= 0) comparisonInputsMissing.push("Enter the asset's fair value.");
  if (!Number.isFinite(payment) || payment <= 0) comparisonInputsMissing.push("Enter a positive monthly rental, excluding the applicable taxes and services.");
  if (!Number.isInteger(months) || months <= 0) comparisonInputsMissing.push("Enter the lease term in whole months.");
  if (!Number.isFinite(rate) || rate < 0 ||
      (rate === 0 && ![ending?.implicitRate, ending?.incrementalBorrowingRate, ending?.discountRate].includes(0))) {
    comparisonInputsMissing.push("Calculate the implicit rate or enter a supported discount rate.");
  }
  if (!ending || ending.version !== 1 || !["mandatory_payment", "guaranteed_residual", "bargain_purchase", "none", "optional_purchase", "lessor_residual"].includes(ending.kind)) {
    comparisonInputsMissing.push("Choose what the client must do at the end of the lease.");
  }
  if (ending && (ending.amount == null || !Number.isFinite(ending.amount) || ending.amount < 0 || ending.kind === "none" && ending.amount !== 0)) {
    comparisonInputsMissing.push("Enter or resolve the ending-value calculation; use an explicit zero if there is no ending amount.");
  }
  if (ending && (!Number.isInteger(ending.settlementMonth) || ending.settlementMonth! < months)) {
    comparisonInputsMissing.push("Confirm when the ending amount is settled, at or after the final rental.");
  }
  if (ending?.servicesMonthly != null && (!Number.isFinite(ending.servicesMonthly) || ending.servicesMonthly < 0)) {
    comparisonInputsMissing.push("Services included each month must be zero or a positive dollar amount.");
  }
  if (ending?.taxTreatment === "recoverable" && (!Number.isFinite(ending.taxRate) || !(Number(ending.taxRate) > 0))) {
    comparisonInputsMissing.push("The rental is marked as including recoverable tax. Enter the included tax rate, or choose Payments exclude taxes if the entered rental is before tax.");
  }
  if (!rental && !comparisonInputsMissing.length) {
    comparisonInputsMissing.push("Check payment timing, the first rental and any upfront payment; these inputs could not produce a rental present value.");
  }
  const hasRequiredEnding = !!ending && ["mandatory_payment", "guaranteed_residual", "bargain_purchase"].includes(ending.kind);
  const comparison = rental && ending && !comparisonInputsMissing.length ? (() => {
    const pv = rental.pv + (hasRequiredEnding ? ending.amount! / (1 + rate / 1200) ** ending.settlementMonth! : 0);
    return { pv, percent: pv / fairValue * 100, meets: pv >= fairValue * 0.9 };
  })() : null;
  const reviewed = ending?.status === "reviewed" && !ending.issues.length;
  const required = reviewed && hasRequiredEnding ? comparison : null;
  // ASPE .03(r), .06(c): the formal comparison includes qualifying terminal
  // obligations. Rent alone is supplementary, never a substitute for MLP.
  const minimum = reviewed ? comparison : null;
  const comparisonPayments = comparison && ending ? {
    rentals: leaseRentalPresentValue({ monthlyPayment: payment, firstPaymentAmount: first,
      termMonths: months, downPayment: Number(a.downPayment ?? 0), paymentAtBeginning: a.paymentTiming === "beginning" }, 0),
    ending: hasRequiredEnding ? ending.amount! : 0,
  } : null;
  const payments = minimum ? comparisonPayments : null;
  const draftComparison = !minimum && comparison && comparisonPayments
    ? { minimum: comparison, payments: comparisonPayments } : null;
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
  return { status, reasons, issues: [...new Set(issues)], rental, required, minimum, payments,
    draftComparison, comparisonInputsMissing, lifePercent, rationale } as const;
}
