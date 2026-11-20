import { format } from "date-fns";
import { formatCurrency as money } from "./format";
import { PrintReport } from "./print-report";
import { printLoanEvidence } from "./loan-print-evidence";
import type { LoanExportMeta, ScheduleRow, YearlyTotal } from "./loan-export";

const date = (d: Date) => format(d, "MMM d, yyyy");
const period = (end?: string | null) =>
  end ? `Reporting year-end: ${end}` : undefined;

function scheduleType(row: ScheduleRow) {
  if (row.rowType === "principal_event")
    return `Principal event: ${row.eventOrdering === "before_scheduled_payment" ? "before" : "after"} payment, #${row.eventSequence ?? 0}; ${row.eventTreatment === "keep_maturity" ? "recast" : "keep payment"}`;
  if (row.rowType === "accrued_interest_settlement")
    return "Interest settlement";
  return row.isGrace
    ? "Grace period"
    : row.isInterestOnly
      ? "Interest only"
      : "Scheduled";
}

/** Ordinary monthly rows fit in portrait. Event descriptions, rates, and large amounts need more width. */
export const scheduleOrientation = (schedule: ScheduleRow[]) =>
  schedule.some(
    (r) =>
      r.rowType === "principal_event" ||
      r.rowType === "accrued_interest_settlement" ||
      r.contractualAnnualRate != null ||
      [r.payment, r.principal, r.interest, r.balance].some(
        (n) => Math.abs(n) >= 100_000_000,
      ),
  )
    ? "landscape"
    : "portrait";

export function printPayments(
  report: PrintReport,
  title: string,
  schedule: ScheduleRow[],
  totals = false,
) {
  const sum = (key: "payment" | "principal" | "interest") =>
    money(schedule.reduce((a, r) => a + r[key], 0));
  const rate = schedule.some((r) => r.contractualAnnualRate != null);
  const wide = scheduleOrientation(schedule) === "landscape";
  report.table({
    title,
    head: [
      "Period",
      "Date",
      "Type",
      "Payment",
      "Principal",
      "Interest",
      "Balance",
      ...(rate ? ["Contract rate"] : []),
    ],
    widths: wide
      ? [7, 13, 20, 15, 15, 15, 15, ...(rate ? [12] : [])]
      : [9, 15, 13, 16, 16, 14, 17],
    right: [0, 3, 4, 5, 6, 7],
    rows: schedule.map((r) => [
      r.month,
      date(r.date),
      scheduleType(r),
      money(r.payment),
      money(r.principal),
      money(r.interest),
      money(r.balance),
      ...(rate
        ? [
            r.contractualAnnualRate == null
              ? "—"
              : `${r.contractualAnnualRate.toFixed(4)}%`,
          ]
        : []),
    ]),
    foot: totals
      ? [
          [
            "",
            "Total",
            "",
            sum("payment"),
            sum("principal"),
            sum("interest"),
            "—",
            ...(rate ? [""] : []),
          ],
        ]
      : undefined,
  });
  if (schedule.some((row) => row.rateSegments?.length)) {
    report.table({
      title: "Contractual rate support by payment",
      head: [
        "Period",
        "Payment date",
        "Accrual period",
        "Annual rate",
        "Segment interest",
        "Rate reset",
      ],
      right: [0, 3, 4],
      rows: schedule.flatMap((r) =>
        (r.rateSegments ?? []).map((s) => [
          r.month,
          date(r.date),
          `${date(s.from)} – ${date(s.to)}`,
          `${s.annualContractualRate.toFixed(4)}%`,
          s.interest == null ? "—" : money(s.interest),
          s.rateResetEventId ?? "—",
        ]),
      ),
    });
  }
}

export function renderSchedulePdf(
  loan: LoanExportMeta,
  schedule: ScheduleRow[],
  quick = false,
) {
  const range = schedule.length
    ? `Schedule: ${date(schedule[0].date)} – ${date(schedule[schedule.length - 1].date)}`
    : undefined;
  const report = new PrintReport(
    {
      title: "Amortization Schedule",
      subject: [loan.name, loan.clientName].filter(Boolean).join("\n"),
      period: period(loan.fiscalYearEnd) ?? range,
    },
    scheduleOrientation(schedule),
  );
  report.paragraph(
    `Principal: ${money(loan.principal)}   ·   Stated rate: ${loan.interestRate}%   ·   Term: ${loan.termYears} years${quick && loan.amortizationYears != null ? `   ·   Amortization: ${loan.amortizationYears} years` : ""}`,
  );
  printPayments(report, "Payment schedule", schedule, quick);
  printLoanEvidence(report, loan);
  return report.finish();
}
export function renderAnnualPdf(
  name: string,
  years: YearlyTotal[],
  loan?: LoanExportMeta,
  quick = false,
) {
  const report = new PrintReport({
    title: "Annual Breakdown",
    subject: [name, loan?.clientName].filter(Boolean).join("\n"),
    period:
      period(loan?.fiscalYearEnd) ??
      (years.length
        ? `${years[0].label} – ${years[years.length - 1].label}`
        : undefined),
  });
  const row = (
    label: string,
    opening: number | undefined,
    principal: number,
    interest: number,
    total: number,
    closing: number | undefined,
  ) => [
    label,
    ...(!quick ? [opening == null ? "—" : money(opening)] : []),
    money(principal),
    money(interest),
    money(total),
    ...(!quick ? [closing == null ? "—" : money(closing)] : []),
  ];
  const sum = (f: (r: YearlyTotal) => number) =>
    years.reduce((v, r) => v + f(r), 0);
  const head = quick
    ? ["Fiscal year", "Principal", "Interest", "Total"]
    : [
        "Fiscal year",
        "Opening balance",
        "Principal",
        "Interest",
        "Total",
        "Closing balance",
      ];
  report.table({
    title: "Activity by fiscal year",
    head,
    right: head.slice(1).map((_, i) => i + 1),
    rows: years.map((r) =>
      row(
        r.label,
        r.opening,
        r.principal,
        r.interest,
        r.principal + r.interest,
        r.closing,
      ),
    ),
    foot: [
      row(
        "Total",
        years[0]?.opening,
        sum((r) => r.principal),
        sum((r) => r.interest),
        sum((r) => r.principal + r.interest),
        years.at(-1)?.closing,
      ),
    ],
  });
  printLoanEvidence(report, loan);
  return report.finish();
}
