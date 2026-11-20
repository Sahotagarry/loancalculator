import type { CellValue, Worksheet } from "exceljs";
import { format } from "date-fns";
import type { LoanExportMeta, ScheduleRow, YearlyTotal } from "./loan-export";
import { addCalculationEvidence, addJournalSupport } from "./loan-workbook-evidence";
import {
  amount,
  calendarDay,
  column,
  dateFormat,
  newBook,
  rateFormat,
  reportTable,
} from "./excel-report-style";

export function scheduleTable(
  ws: Worksheet,
  name: string,
  start: number,
  schedule: ScheduleRow[],
  kind: "saved" | "quick" | "package",
) {
  const columns = [
    column(kind === "quick" ? "Month" : "Period", 12),
    column("Date", 23, dateFormat),
    amount("Payment", true),
    amount("Principal", true),
    amount("Interest", true),
  ];
  if (kind !== "package") columns.push(amount("Total Interest"));
  columns.push(amount("Balance"));
  if (kind === "saved") columns.push(column("Contractual rate", 20, rateFormat), column("Rate evidence", 54));
  if (kind !== "package") columns.push(column("Type", 30));
  const rows = schedule.map((r) => {
    const values: CellValue[] = [r.month, calendarDay(r.date), r.payment, r.principal, r.interest];
    if (kind !== "package") values.push(r.totalInterest);
    values.push(r.balance);
    if (kind === "saved")
      values.push(
        r.contractualAnnualRate == null ? null : r.contractualAnnualRate / 100,
        r.rateSegments
          ?.map(
            (s) =>
              `${format(s.from, "yyyy-MM-dd")}–${format(s.to, "yyyy-MM-dd")}: ${s.annualContractualRate.toFixed(4)}%${s.rateResetEventId ? ` (${s.rateResetEventId})` : ""}`,
          )
          .join("; ") || null,
      );
    if (kind !== "package")
      values.push(
        r.rowType === "principal_event"
          ? `Principal event (${r.eventOrdering === "before_scheduled_payment" ? "before" : "after"} payment; #${r.eventSequence ?? 0}; ${r.eventTreatment ?? "keep_payment"})`
          : r.rowType === "accrued_interest_settlement"
            ? "Accrued interest settlement"
            : r.isGrace
              ? "Grace Period"
              : r.isInterestOnly
                ? "Interest Only"
                : "Standard",
      );
    return values;
  });
  reportTable(ws, name, start, columns, rows);
  ws.views = [{ state: "frozen", ySplit: start }];
}
export function buildScheduleWorkbook(schedule: ScheduleRow[], evidence?: LoanExportMeta, quick = false) {
  const wb = newBook();
  scheduleTable(
    wb.addWorksheet(quick ? "Amortization Schedule" : "Schedule"),
    "PaymentSchedule",
    1,
    schedule,
    quick ? "quick" : "saved",
  );
  if (evidence) {
    addCalculationEvidence(wb, evidence);
    addJournalSupport(wb, evidence.fairValueAccountingEntries, false);
  }
  return wb;
}
export function buildAnnualWorkbook(annual: YearlyTotal[], evidence?: LoanExportMeta, quick = false) {
  const wb = newBook(),
    ws = wb.addWorksheet(quick ? "Annual Breakdown" : "Annual");
  const cols = [
    column("Fiscal Year", 30, '"Year ending "mmm d, yyyy'),
    ...(quick ? [] : [amount("Opening Balance")]),
    amount("Principal", true),
    amount("Interest", true),
    amount("Total", true),
    ...(quick ? [] : [amount("Closing Balance")]),
  ];
  reportTable(
    ws,
    "FiscalYearBreakdown",
    1,
    cols,
    annual.map((r) => [
      r.yearEnd ? calendarDay(r.yearEnd) : /^\d{4}$/.test(r.label) ? Number(r.label) : r.label,
      ...(quick ? [] : [r.opening ?? null]),
      r.principal,
      r.interest,
      r.principal + r.interest,
      ...(quick ? [] : [r.closing ?? null]),
    ]),
  );
  annual.forEach((r, i) => {
    if (!r.yearEnd) ws.getCell(i + 2, 1).numFmt = "General";
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  addJournalSupport(wb, evidence?.fairValueAccountingEntries, true);
  return wb;
}
