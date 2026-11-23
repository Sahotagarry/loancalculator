import { addMonths } from "date-fns";
import type { AmortizationResult, AmortizationRow } from "./index";
import { leaseImplicitRate, leasePresentValue, lesseeEndingAmount, normalizeLeaseEnding, type LeaseCashFlows } from "./lease-ending";

/** Payment-date balances; settlement accrual is separate from the last advance rental. */
export function calculateLeaseSchedule(a: LeaseCashFlows & { annualRate: number; startDate: Date; openingAmount?: number }): AmortizationResult {
  const ending = normalizeLeaseEnding(a.ending, a.termMonths);
  const residual = lesseeEndingAmount(ending);
  if (!Number.isFinite(a.startDate.getTime())) throw new Error("Invalid lease commencement.");
  const opening = a.openingAmount ?? leasePresentValue({ ...a, ending }, a.annualRate) - a.downPayment;
  if (!Number.isFinite(opening) || opening < 0) throw new Error("Invalid opening lease liability.");
  let balance = opening, totalInterest = 0;
  // The fair-value ceiling can lower the recorded obligation below classification
  // PV. Allocate the fixed cash flows over that recorded basis, not an inflated asset.
  const pv = leasePresentValue({ ...a, ending }, a.annualRate) - a.downPayment;
  const cappedRate = opening < pv - 0.01 ? leaseImplicitRate({
    ...a, ending: ending.kind === "lessor_residual" ? { ...ending, kind: "none", amount: 0 } : ending,
  }, opening + a.downPayment) : a.annualRate;
  if (cappedRate == null) throw new Error("Fair-value ceiling cannot be reconciled to supported cash flows.");
  const r = cappedRate / 1200;
  let priorMonth = 0;
  const schedule: AmortizationRow[] = [];
  for (let i = 0; i < a.termMonths; i++) {
    const month = i + (a.paymentAtBeginning ? 0 : 1);
    const interest = balance * ((1 + r) ** (month - priorMonth) - 1);
    const payment = i === 0 ? a.firstPaymentAmount ?? a.monthlyPayment : a.monthlyPayment;
    const principal = payment - interest;
    totalInterest += interest;
    balance -= principal;
    if (balance < -0.02) throw new Error("Lease cash flows exceed the opening obligation; review fair value and rate.");
    schedule.push({ month: i + 1, date: addMonths(a.startDate, month), openingBalance: balance + principal,
      payment, principal, interest, totalInterest, balance: Math.max(0, balance), isInterestOnly: false });
    priorMonth = month;
  }
  // An unpaid settlement balance remains for maturity disclosure. No assumed purchase cash.
  const settlementMonth = ending.settlementMonth!;
  if (settlementMonth > priorMonth && (balance > 0.005 || residual > 0)) {
    const interest = balance * ((1 + r) ** (settlementMonth - priorMonth) - 1);
    totalInterest += interest;
    balance += interest;
    schedule.push({ month: a.termMonths + 1, date: addMonths(a.startDate, settlementMonth),
      payment: 0, principal: -interest, interest, totalInterest, balance, isInterestOnly: false,
      rowType: "accrued_interest_settlement",
      openingBalance: balance - interest });
  }
  if (Math.abs(balance - residual) > 0.05) throw new Error("Ending liability does not reconcile to the supported settlement. Review rate and opening value.");
  return { schedule, monthlyPayment: a.monthlyPayment, totalInterest,
    totalPayment: schedule.reduce((sum, row) => sum + row.payment, 0) + residual,
    evidenceMetadata: { leaseEndingTerms: ending, calculationBasis: "lease-payment-dates-v1" } };
}
