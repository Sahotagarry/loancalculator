import ExcelJS, { type Cell, type Worksheet } from "exceljs";
import type { Workpaper } from "./workpaper-export";

import { font, tableStyle } from "./excel-report-style";

type Section = Workpaper["sections"][number];

const currency = '"$"#,##0.00;-"$"#,##0.00';
const negativeCurrency = '"$"#,##0.00;("$"#,##0.00)';
const decimal = "#,##0.00";
const margins = { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
const rounded = (v: number) => Number(v.toFixed(2));

/** Only entire monetary/percentage literals are numeric. Evidence and prose stay verbatim. */
function put(cell: Cell, value: string | number) {
  cell.font = font;
  if (typeof value === "string") {
    const amount = /^(?:-?\$(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}|\(\$(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}\))$/.test(value);
    const percent = /^-?\d+\.(\d+)%$/.exec(value);
    if (amount) {
      const bracket = value.startsWith("(");
      cell.value = Number(value.replace(/[$,()]/g, "")) * (bracket ? -1 : 1);
      cell.numFmt = bracket ? negativeCurrency : currency;
      return;
    }
    if (percent) {
      cell.value = Number(value.slice(0, -1)) / 100;
      cell.numFmt = `0.${"0".repeat(percent[1].length)}%`;
      return;
    }
  }
  cell.value = value;
}

function sheet(wb: ExcelJS.Workbook, title: string) {
  const base = title.replace(/[\\/?*[\]:]/g, "").replace(/^'+|'+$/g, "").trim() || "Workpaper";
  let name = base.slice(0, 31);
  for (let i = 2; wb.worksheets.some(s => s.name.toLowerCase() === name.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  return wb.addWorksheet(name, { properties: { defaultRowHeight: 15.75 }, pageSetup: { margins } });
}

function widths(ws: Worksheet, values: number[]) {
  values.forEach((width, i) => { ws.getColumn(i + 1).width = width; });
}
function wrapCell(cell: Cell, text: string, width: number, ws: Worksheet) {
  const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / width)), 0);
  cell.alignment = { wrapText: true, vertical: "middle" };
  const row = ws.getRow(Number(cell.row));
  row.height = Math.min(409, Math.max(row.height ?? 15.75, lines * 16));
}

/** Keep the simple title / blank row / column headings of the supporting tabs. */
function writeSection(ws: Worksheet, wp: Workpaper, section: Section, start: number) {
  const title = `${wp.loanName} — ${section.title}`;
  const cols = Math.max(2, section.head.length);
  ws.mergeCells(start, 1, start, cols);
  const titleCell = ws.getCell(start, 1);
  put(titleCell, title);
  wrapCell(titleCell, title, 80, ws);
  section.head.forEach((v, i) => put(ws.getCell(start + 2, i + 1), v));
  let row = start + 3;
  for (const values of section.rows) {
    if (section.head.length === 1) ws.mergeCells(row, 1, row, cols);
    values.forEach((v, c) => {
      const cell = ws.getCell(row, c + 1);
      put(cell, v);
      const width = section.head.length === 1 ? 79 : (ws.getColumn(c + 1).width ?? 30) - 2;
      if (typeof cell.value === "string" && cell.value.length > width) wrapCell(cell, cell.value, width, ws);
    });
    row++;
  }
  if (section.notes?.length) {
    row++;
    for (const note of section.notes) {
      ws.mergeCells(row, 1, row, cols);
      put(ws.getCell(row, 1), note);
      wrapCell(ws.getCell(row, 1), note, 79, ws);
      row++;
    }
  }
  return row - 1;
}

function rightHandTable(ws: Worksheet, wp: Workpaper, section: Section, top: number, name: string, subtotal: boolean) {
  ws.mergeCells(top, 8, top + 1, 9);
  const heading = ws.getCell(top, 8);
  heading.value = `${wp.loanName} — ${section.title}`;
  heading.font = { ...font, bold: true };
  heading.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  const headingHeight = Math.max(15.75, Math.ceil(heading.value.length / 49) * 8);
  ws.getRow(top).height = ws.getRow(top + 1).height = headingHeight;

  const data = subtotal ? section.rows.filter(r => r[0] !== "Total") : section.rows;
  const first = top + 3;
  ws.addTable({
    name, ref: `H${first}`, headerRow: true, totalsRow: subtotal, style: tableStyle,
    columns: section.head.map((h, i) => ({
      name: h, filterButton: true,
      ...(subtotal && i === 0 ? { totalsRowLabel: "Total" } : {}),
      ...(subtotal && i === 1 ? { totalsRowFunction: "sum" as const } : {}),
    })),
    rows: data.map(r => [...r]),
  });
  ws.getCell(first, 8).font = ws.getCell(first, 9).font = { ...font, bold: true };
  for (let i = 0; i < data.length; i++) {
    const row = first + i + 1;
    data[i].forEach((v, c) => {
      const cell = ws.getCell(row, c + 8);
      put(cell, subtotal && c === 0 && /^\d{4}$/.test(String(v)) ? Number(v) : v);
      if (c === 0 && typeof v === "string" && v.length > 30) wrapCell(cell, v, 31, ws);
    });
  }
  let end = first + data.length;
  if (subtotal) {
    const sum = rounded(data.reduce((acc, _, i) => acc + Number(ws.getCell(first + i + 1, 9).value), 0));
    const total = ws.getCell(++end, 9);
    total.value = { formula: `SUBTOTAL(109,${name}[${section.head[1]}])`, result: sum };
    total.numFmt = currency;
  }
  for (const note of section.notes ?? []) {
    end++;
    ws.mergeCells(end, 8, end, 9);
    put(ws.getCell(end, 8), note);
    wrapCell(ws.getCell(end, 8), note, 50, ws);
  }
  return end;
}

export function buildAgreementWorkbook(wp: Workpaper): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const used = new Set<Section>();
  if (wp.schedule?.length) {
    const ws = sheet(wb, "Schedule");
    widths(ws, [8.5, 17.25, 10.5, 10.375, 9.5, 9.875, 8.5, 31.25, 21]);
    ws.addTable({
      name: "PaymentSchedule", ref: "A1", headerRow: true, totalsRow: false, style: tableStyle,
      columns: ["Period", "Date", "Payment", "Principal", "Interest", "Balance"].map(name => ({ name, filterButton: true })),
      rows: wp.schedule.map(r => [
        r.month, new Date(Date.UTC(r.date.getFullYear(), r.date.getMonth(), r.date.getDate())),
        ...[r.payment, r.principal, r.interest, r.balance].map(rounded),
      ]),
    });
    for (let col = 1; col <= 6; col++) ws.getCell(1, col).font = { ...font, bold: true };
    ws.getColumn(2).numFmt = "mmmm d, yyyy";
    for (let col = 3; col <= 6; col++) {
      const column = ws.getColumn(col);
      column.numFmt = decimal;
      // Expand only when the loan's amounts would overflow the reference widths.
      column.eachCell((cell, row) => {
        if (row > 1 && typeof cell.value === "number") column.width = Math.max(column.width!, cell.value.toLocaleString("en-CA", { minimumFractionDigits: 2 }).length + 1.5);
      });
    }
    let top = 1;
    for (const [prefix, name, subtotal, gap] of [
      ["Principal Repayments — ", "PrincipalMaturities", true, 2],
      ["Continuity — ", "YearEndContinuity", false, 3],
      ["Balance Sheet Presentation", "BalanceSheetPresentation", false, 2],
    ] as const) {
      const s = wp.sections.find(s => s.title.startsWith(prefix));
      if (s) { used.add(s); top = rightHandTable(ws, wp, s, top, name, subtotal) + gap; }
    }
    ws.eachRow(row => row.eachCell(cell => {
      if (!cell.isMerged && !cell.style.font) cell.font = font;
    }));
  }
  const terms = wp.sections.find(s => s.title === "Terms");
  const security = wp.sections.find(s => s.title === "Security & Related Assets");
  if (terms || security) {
    const ws = sheet(wb, "Terms & Security");
    widths(ws, [50.875, 30.875]);
    const end = terms ? writeSection(ws, wp, terms, 1) : 0;
    if (terms) used.add(terms);
    if (security) {
      used.add(security);
      writeSection(ws, wp, security, terms ? Math.max(21, end + 3) : 1);
    }
  }
  const draft = wp.sections.find(s => s.title === "Draft Note Disclosure");
  const remaining = wp.sections.filter(s => !used.has(s) && s !== draft);
  for (const s of draft ? [draft, ...remaining] : remaining) {
    const ws = sheet(wb, s.title);
    widths(ws, [50.875, 30.875, ...s.head.slice(2).map(() => 30)]);
    writeSection(ws, wp, s, 1);
  }
  return wb;
}
