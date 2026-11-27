import { format, parseISO } from "date-fns";
import { buildLoanSummary, type BookedScheduleInput, type YearlyBreakdown } from "./aspe-utils";
import { getFiscalYear, getFyEndParts } from "./fiscal";
import { formatCurrency } from "./format";
import type { FileWorkpaperInput, Workpaper } from "./workpaper-export";

/** Shared consolidated disclosure support. Reuse the individual summaries,
 * including balloons and transition accounting, without changing their output.
 * Bucket against the reporting FYE, not each agreement's first payment year. */
export function buildFileRepaymentSummaries(
  input: FileWorkpaperInput,
  cells: { amount(n: number): string | number; deduction(n: number): string | number } = {
    amount: formatCurrency, deduction: n => `(${formatCurrency(n)})`,
  },
): Workpaper[] {
  const date = parseISO(input.fiscalYearEnd);
  const fyEnd = getFyEndParts(input.fiscalYearEnd);
  const fy = getFiscalYear(date, fyEnd.month, fyEnd.day);
  const loanPrincipal = Array<number>(6).fill(0);
  const leasePrincipal = Array<number>(6).fill(0);
  const leasePayments = Array<number>(6).fill(0);
  let loans = 0, leases = 0, interest = 0, liability = 0;
  const byId = new Map(input.loans.map(loan => [loan.id, loan]));
  const predecessors = new Set(input.loans
    .filter(loan => loan.modificationAssessment?.status === "confirmed")
    .map(loan => loan.predecessorAgreementId).filter(Boolean));
  function add(target: number[], rows: YearlyBreakdown[]) {
    for (const row of rows) {
      const bucket = row.label === "Thereafter" ? 5 : row.fiscalYear - fy - 1;
      if (bucket >= 0) target[Math.min(5, bucket)] += row.amount;
    }
  }
  for (const loan of input.loans) {
    if (predecessors.has(loan.id)) continue;
    const summary = buildLoanSummary({
      ...loan,
      predecessorAgreement: loan.predecessorAgreementId
        ? byId.get(loan.predecessorAgreementId) as BookedScheduleInput | undefined
        : loan.predecessorAgreement,
    }, date, input.fiscalYearEnd);
    if (!summary || "monthlyStraightLineExpense" in summary) continue;
    if ("yearlyBlended" in summary) {
      leases++;
      add(leasePrincipal, summary.yearlyPrincipal);
      add(leasePayments, summary.yearlyBlended);
      interest += summary.impliedInterest;
      liability += summary.obligations;
    } else {
      loans++;
      add(loanPrincipal, summary.yearlyPrincipal);
    }
  }
  const total = (values: number[]) => values.reduce((sum, n) => sum + n, 0);
  const rows = (values: number[]) => values.map((n, i) => [
    i === 5 ? "Thereafter" : String(fy + i + 1), cells.amount(n),
  ]);
  const principal = (values: number[]) => ({
    title: "Principal Repayments — Next Five Years & Thereafter",
    head: ["Fiscal year", "Principal"],
    rows: [...rows(values), ["Total", cells.amount(total(values))]],
    notes: ["Contractual principal repayments, including maturity balloons, are grouped by the Year-End File's fiscal years. Covenant-related current classification does not accelerate this contractual schedule."],
  });
  const meta = { clientName: input.clientName, fyeLabel: format(date, "MMMM d, yyyy"), schedule: null };
  const result: Workpaper[] = [];
  if (loans) result.push({
    ...meta, loanName: "All loans", typeLabel: "Loan Repayment Summary",
    sections: [principal(loanPrincipal)],
  });
  if (leases) result.push({
    ...meta, loanName: "All capital leases", typeLabel: "Capital Lease Summary",
    sections: [principal(leasePrincipal), {
      title: "Future Minimum Lease Payments & Liability Reconciliation",
      head: ["Fiscal year", "Payment"],
      rows: [
        ...rows(leasePayments),
        ["Total minimum lease payments", cells.amount(total(leasePayments))],
        ["Less: amount representing interest", cells.deduction(interest)],
        ["Capital lease liability at year end", cells.amount(liability)],
      ],
      notes: ["Includes all remaining future minimum capital lease payments, including thereafter and qualifying ending amounts. The interest deduction is future interest included in those payments, not the current-year interest expense. Operating leases are excluded."],
    }],
  });
  return result;
}
