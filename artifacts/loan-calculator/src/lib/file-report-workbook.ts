import type { CellValue, Worksheet } from "exceljs";
import { format, isValid, parse } from "date-fns";
import {
  buildFileWorkpapers,
  buildLeadSheet,
  excelNumbers,
  DEBT_LEAD_HEAD,
  OP_LEAD_HEAD,
  type FileWorkpaperInput,
  type Workpaper,
} from "./workpaper-export";
import {
  amount,
  calendarDay,
  column,
  dateFormat,
  font,
  heading,
  isoDay,
  moneyFormat,
  newBook,
  rateFormat,
  reportTable,
  wrap,
  workpaperHeader,
} from "./excel-report-style";
import { scheduleTable } from "./loan-report-workbook";
import { buildFileRepaymentSummaries } from "./file-repayment-summaries";

type Section = Workpaper["sections"][number];
const ref = (i: number) => String(i + 1).padStart(2, "0");
function tabName(index: number, purpose: string, name: string) {
  const prefix = `${ref(index)} ${purpose} - `;
  const safe = name.replace(/[\\/?*[\]:\x00-\x1f]/g, " ").trim() || "Agreement";
  return (prefix + safe).slice(0, 31).replace(/[\uD800-\uDBFF'\s]+$/g, "");
}
function reportDate(value: string) {
  const iso = isoDay(value);
  if (iso instanceof Date) return iso;
  const d = parse(value, "MMMM d, yyyy", new Date(2000, 0, 1));
  return isValid(d) && format(d, "MMMM d, yyyy") === value ? calendarDay(d) : value;
}
/** Section builders also feed PDF; type only known financial/date fields, never arbitrary evidence. */
function detailValue(
  section: Section,
  row: (string | number)[],
  i: number,
): { value: CellValue; fmt?: string } {
  const v = row[i],
    key = String(row[0]),
    head = section.head[i];
  if (v === "") return { value: null };
  if (i === 0 && head === "Fiscal year" && /^\d{4}$/.test(String(v))) return { value: Number(v) };
  if (
    typeof v === "string" &&
    (head === "Date" ||
      head === "Effective" ||
      (head === "Fiscal year" && i === 0) ||
      (i === 1 && ["Start date", "Maturity date", "First payment date", "Effective date"].includes(key)))
  ) {
    const d = reportDate(v);
    if (d instanceof Date) return { value: d, fmt: dateFormat };
  }
  if (typeof v === "number") {
    const fmt = [
      "Stated rate",
      "Market (effective) rate",
      "Discount rate used",
      "Original effective rate",
    ].includes(key)
      ? rateFormat
      : key === "Settlement month" || head === "Fiscal year"
        ? "0"
        : moneyFormat;
    return { value: v, fmt };
  }
  return { value: v };
}
function detailSheet(ws: Worksheet, wp: Workpaper, index: number, summary = false) {
  const n = Math.max(2, ...wp.sections.map((s) => s.head.length));
  for (let i = 1; i <= n; i++) ws.getColumn(i).width = i === 1 ? 47 : i === 2 ? 56 : 26;
  workpaperHeader(ws, n, wp.clientName, wp.fyeLabel);
  heading(ws, 3, n, summary ? wp.typeLabel : `${ref(index)} · ${wp.loanName} — ${wp.typeLabel} Workpaper`);
  let row = 4;
  wp.sections.forEach((s, idx) => {
    heading(ws, row++, n, s.title, true);
    if (s.head.length === 1) {
      ws.getCell(row++, 1).value = s.head[0];
      for (const [value] of s.rows) {
        ws.mergeCells(row, 1, row, n);
        const c = ws.getCell(row, 1);
        c.value = value;
        c.font = font;
        c.alignment = { wrapText: true };
        wrap(ws, row, String(value), 98);
        row++;
      }
    } else {
      // Keep the capital-lease interest deduction and obligation outside the
      // filterable maturities; neither belongs in the minimum-payment subtotal.
      const totalAt =
        s.head[0] === "Fiscal year"
          ? s.rows.findIndex((r) => r[0] === "Total" || r[0] === "Total minimum lease payments")
          : -1;
      const summed = totalAt >= 0;
      const values = (summed ? s.rows.slice(0, totalAt) : s.rows).map((r) =>
        r.map((_, i) => detailValue(s, r, i)),
      );
      const first = row;
      row =
        reportTable(
          ws,
          `Detail_${index + 1}_${idx + 1}`,
          row,
          s.head.map((h, i) =>
            column(
              h,
              i === 0 ? 47 : i === 1 ? 56 : 26,
              undefined,
              (summed && i === 1) || h === "Debit" || h === "Credit",
            ),
          ),
          values.map((r) => r.map((c) => c.value)),
          summed ? String(s.rows[totalAt][0]) : "Total",
        ) + 1;
      values.forEach((r, ri) =>
        r.forEach(({ fmt }, ci) => {
          if (fmt) ws.getCell(first + ri + 1, ci + 1).numFmt = fmt;
        }),
      );
      if (summed) {
        ws.getCell(row - 1, 2).numFmt = moneyFormat;
        for (const support of s.rows.slice(totalAt + 1)) {
          support.forEach((_, i) => {
            const { value, fmt } = detailValue(s, support, i),
              c = ws.getCell(row, i + 1);
            c.value = value;
            c.font = font;
            if (fmt) c.numFmt = fmt;
          });
          row++;
        }
      }
      for (const h of ["Debit", "Credit"])
        if (s.head.includes(h)) ws.getCell(row - 1, s.head.indexOf(h) + 1).numFmt = moneyFormat;
    }
    for (const note of s.notes ?? []) {
      ws.mergeCells(row, 1, row, n);
      const c = ws.getCell(row, 1);
      c.value = note;
      c.font = { ...font, italic: true };
      c.alignment = { wrapText: true };
      wrap(ws, row, note, 98);
      row++;
    }
    row++;
  });
}
export function buildFileWorkbook(input: FileWorkpaperInput, includeDetails: boolean) {
  const workpapers = buildFileWorkpapers(input, excelNumbers);
  if (!workpapers.length) return null;
  const lead = buildLeadSheet(input, workpapers, excelNumbers);
  const wb = newBook(),
    ws = wb.addWorksheet("Lead Sheet");
  const indices = workpapers.map((w, i) => ({ operating: w.typeLabel === "Operating Lease", ref: ref(i) }));
  const debts = indices.filter((x) => !x.operating),
    leases = indices.filter((x) => x.operating);
  ws.getColumn(1).width = 41;
  ws.getColumn(2).width = 38;
  workpaperHeader(ws, 9, input.clientName, lead.fyeLabel);
  heading(ws, 3, 9, "Debt & Lease Lead Sheet");
  let row = 4;
  if (lead.debtRows.length) {
    heading(ws, row++, 9, "Loans & Capital Leases", true);
    row =
      reportTable(
        ws,
        "DebtLead",
        row,
        DEBT_LEAD_HEAD.map((h, i) =>
          i >= 4
            ? amount(h, true)
            : column(h, [41, 38, 16, 23][i], i === 2 ? rateFormat : i === 3 ? dateFormat : undefined),
        ).concat(column("Ref.", 10)),
        lead.debtRows.map((r, i) => [
          ...r.slice(0, 3),
          reportDate(String(r[3])),
          ...r.slice(4),
          debts[i].ref,
        ]),
        "Total debt",
      ) + 1;
    for (const r of lead.debtBreakdownRows) {
      ws.mergeCells(row, 1, row, 5);
      const c = ws.getCell(row, 1);
      c.value = r[0];
      c.alignment = { wrapText: true };
      wrap(ws, row, String(r[0]), 100);
      ws.getCell(row, 6).value = r[5];
      ws.getCell(row, 6).numFmt = moneyFormat;
      row++;
    }
    for (const note of lead.debtNotes) {
      ws.mergeCells(row, 1, row, 9);
      const c = ws.getCell(row, 1);
      c.value = note;
      c.font = { ...font, italic: true, color: { argb: "FF963B22" } };
      c.alignment = { wrapText: true };
      wrap(ws, row, note, 150);
      row++;
    }
    row++;
  }
  if (lead.operatingRows.length) {
    heading(ws, row++, 7, "Operating Leases", true);
    reportTable(
      ws,
      "OperatingLead",
      row,
      OP_LEAD_HEAD.map((h, i) =>
        i < 2 ? column(h, i === 0 ? 41 : 38) : amount(h, i === 3 || i === 5),
      ).concat(column("Ref.", 10)),
      lead.operatingRows.map((r, i) => [...r, leases[i].ref]),
      "Total operating leases",
    );
  }
  if (includeDetails) {
    for (const [i, summary] of buildFileRepaymentSummaries(input, excelNumbers).entries()) {
      detailSheet(wb.addWorksheet(summary.typeLabel === "Loan Repayment Summary" ? "Loan Repayment Summary" : "Capital Lease Summary"),
        summary, workpapers.length + i, true);
    }
    workpapers.forEach((wp, i) => {
      detailSheet(wb.addWorksheet(tabName(i, "Detail", wp.loanName)), wp, i);
      if (wp.schedule?.length) {
        const sched = wb.addWorksheet(tabName(i, "Schedule", wp.loanName));
        scheduleTable(sched, `Schedule_${i + 1}`, 5, wp.schedule, "package");
        workpaperHeader(sched, 6, wp.clientName, wp.fyeLabel);
        heading(sched, 3, 6, `${ref(i)} · ${wp.loanName} — ${wp.typeLabel} Schedule`);
      }
    });
  }
  return wb;
}
