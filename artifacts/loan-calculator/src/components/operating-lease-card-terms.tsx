import type { Loan } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { buildOperatingLeasePayments } from "@/lib/straight-line";

type CardLease = Pick<Loan, "monthlyPayment" | "firstPaymentAmount" | "termMonths"
  | "freeRentMonths" | "rentEscalationRate" | "rentSteps">;

/** Display the same contractual cash stream used by the operating workpaper. */
export function OperatingLeaseCardTerms({ loan }: { loan: CardLease }) {
  const monthly = Number(loan.monthlyPayment ?? 0);
  const term = loan.termMonths ?? 0;
  const total = buildOperatingLeasePayments({
    baseMonthlyRent: monthly,
    firstPaymentAmount: loan.firstPaymentAmount == null ? null : Number(loan.firstPaymentAmount),
    termMonths: term,
    freeRentMonths: loan.freeRentMonths ?? 0,
    escalationRate: Number(loan.rentEscalationRate ?? 0),
    rentSteps: loan.rentSteps,
  }).reduce((sum, payment) => sum + payment, 0);

  return (
    <div className="text-sm space-y-1">
      <div className="flex justify-between"><span className="text-muted-foreground">Monthly Payment</span><span className="font-medium">{formatCurrency(monthly)}</span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">Term</span><span className="font-medium">{term} months</span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">Total Commitment</span><span className="font-medium">{formatCurrency(total)}</span></div>
    </div>
  );
}
