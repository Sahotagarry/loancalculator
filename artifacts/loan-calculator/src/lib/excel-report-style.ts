import ExcelJS, { type CellValue, type Worksheet } from "exceljs";
import { saveAs } from "file-saver";

export const font = { name: "Calibri", size: 12 };
export const tableStyle = { theme: "TableStyleMedium9" as const, showRowStripes: true };
export const moneyFormat = '"$"#,##0.00;("$"#,##0.00)';
export const rateFormat = "0.0000%";
export const dateFormat = "mmmm d, yyyy";
export const calendarDay = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
export function isoDay(s?: string | null) {
  // Use the source calendar day, not midnight in the viewer's time zone.
  return s && /^\d{4}-\d\d-\d\d$/.test(s) ? new Date(s + "T00:00:00Z") : (s ?? null);
}
export function newBook() {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}
export async function saveWorkbook(book: ExcelJS.Workbook, filename: string) {
  const buffer = await book.xlsx.writeBuffer();
  saveAs(
    new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );
}
export function heading(ws: Worksheet, row: number, columns: number, text: string, section = false) {
  ws.mergeCells(row, 1, row, columns);
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = { ...font, size: section ? 12 : 14, bold: true, color: { argb: "FFFFFFFF" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: section ? "FF37704C" : "FF244734" } };
  cell.alignment = { vertical: "middle", wrapText: true };
  wrap(
    ws,
    row,
    text,
    Array.from({ length: columns }, (_, i) => ws.getColumn(i + 1).width ?? 12).reduce((a, b) => a + b, 0),
  );
  ws.getRow(row).height = Math.max(ws.getRow(row).height ?? 0, section ? 23 : 28);
}
export function wrap(ws: Worksheet, row: number, text: string, width: number) {
  const lines = text
    .split("\n")
    .reduce((n, s) => n + Math.max(1, Math.ceil(s.length / Math.max(4, width - 2))), 0);
  ws.getRow(row).height = Math.min(409, Math.max(ws.getRow(row).height ?? 0, 17 * lines));
}
export interface ReportColumn {
  name: string;
  width: number;
  format?: string;
  sum?: boolean;
}
export const column = (name: string, width: number, format?: string, sum?: boolean): ReportColumn => ({
  name,
  width,
  format,
  sum,
});
export const amount = (name: string, sum = false) => column(name, 19, moneyFormat, sum);

/** Shared top-left identification on every consolidated-workpaper worksheet. */
export function workpaperHeader(ws: Worksheet, columns: number, clientName: string, yearEnd: string) {
  for (const [index, text] of [`Client name: ${clientName}`, `Year-end: ${yearEnd}`].entries()) {
    const row = index + 1;
    ws.mergeCells(row, 1, row, columns);
    const cell = ws.getCell(row, 1);
    cell.value = text;
    cell.font = { ...font, bold: true, size: 12 };
    cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    wrap(ws, row, text, Array.from({ length: columns }, (_, i) => ws.getColumn(i + 1).width ?? 12).reduce((a, b) => a + b, 0));
    ws.getRow(row).height = Math.max(20, ws.getRow(row).height ?? 0);
  }
  ws.pageSetup.printTitlesRow = "1:3";
}

/** Write typed cells, never infer a numeric or formula value from arbitrary text. */
export function reportTable(
  ws: Worksheet,
  name: string,
  start: number,
  cols: ReportColumn[],
  rows: CellValue[][],
  totalsLabel = "Total",
) {
  const totals = cols.some((c) => c.sum);
  // ExcelJS serializes empty structured tables, but Excel may reject them
  // (exceljs/exceljs#2678). Keep empty sections as ordinary cells, including
  // their zero totals, without inventing a repayment row.
  const hasTable = rows.length > 0;
  if (hasTable)
    ws.addTable({
      name,
      ref: `A${start}`,
      headerRow: true,
      totalsRow: totals,
      style: tableStyle,
      columns: cols.map((c, i) => ({
        name: c.name,
        filterButton: true,
        ...(totals && !i ? { totalsRowLabel: totalsLabel } : {}),
        ...(c.sum ? { totalsRowFunction: "sum" as const } : {}),
      })),
      rows,
    });
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(col.width ?? 0, c.width, c.name.length + 5);
    const header = ws.getCell(start, i + 1);
    header.value = c.name;
    header.font = { ...font, bold: true, color: { argb: "FFFFFFFF" } };
    // Header-only evidence sections retain their original columns but do not
    // create an empty table or invent a first transaction for Excel to filter.
    if (!hasTable)
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF37704C" } };
    let sum = 0,
      largest = 0;
    rows.forEach((r, offset) => {
      const row = start + 1 + offset,
        cell = ws.getCell(row, i + 1),
        v = r[i];
      cell.font = font;
      if (c.format && typeof v !== "string") cell.numFmt = c.format;
      if (typeof v === "number") {
        if (c.sum) sum += v;
        largest = Math.max(largest, Math.abs(v));
      }
      if (typeof v === "string") {
        cell.alignment = { wrapText: true, vertical: "top" };
        wrap(ws, row, v, col.width!);
      }
    });
    if (c.format === moneyFormat)
      col.width = Math.max(
        col.width!,
        Math.max(largest, Math.abs(sum)).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).length + 6,
      );
    if (totals) {
      const cell = ws.getCell(start + 1 + rows.length, i + 1);
      if (!hasTable && i === 0) cell.value = totalsLabel;
      cell.font = { ...font, bold: true };
      cell.border = { top: { style: "thin", color: { argb: "FF37704C" } } };
      if (c.sum) {
        cell.value = hasTable ? { formula: `SUBTOTAL(109,${name}[${c.name}])`, result: sum } : sum;
        cell.numFmt = c.format ?? "General";
      }
    }
  });
  ws.getRow(start).height = 22;
  return start + rows.length + (totals ? 1 : 0);
}
