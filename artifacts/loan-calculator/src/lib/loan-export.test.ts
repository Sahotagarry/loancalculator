import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { exportAnnualPdf, exportSchedulePdf, exportAnnualXlsx, exportScheduleXlsx, type LoanExportMeta, type ScheduleRow } from "./loan-export";
import { buildAnnualWorkbook, buildScheduleWorkbook } from "./loan-report-workbook";
import { buildFileWorkbook } from "./file-report-workbook";
import { exportFileLeadSheetXlsx, exportFileWorkpapersXlsx, buildFileWorkpapers } from "./workpaper-export";
import { annualRows, evidence, file, loan, schedule } from "./excel-example-data";
import { buildFairValueAccountingEntries } from "./aspe-utils";
import { renderAnnualPdf, renderSchedulePdf } from "./loan-print";
import type { Workbook } from "exceljs";

vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
vi.mock("./loan-print", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./loan-print")>()),
  renderSchedulePdf: vi.fn(() => ({ save: vi.fn() })),
  renderAnnualPdf: vi.fn(() => ({ save: vi.fn() })),
}));

async function reopen(wb: Workbook) {
  const book = XLSX.read(await wb.xlsx.writeBuffer(), {
    type: "buffer",
    cellNF: true,
    cellDates: false,
    bookFiles: true,
  }) as XLSX.WorkBook & { files: Record<string, { content: Uint8Array }> };
  const tables = Object.entries(book.files)
    .filter(([name]) => /^xl\/tables\/table\d+\.xml$/.test(name))
    .map(([, f]) => new TextDecoder().decode(f.content));
  expect(tables.length).toBeGreaterThan(0);
  for (const table of tables) {
    expect(table).toContain('name="TableStyleMedium9"');
    expect(table).toContain('showRowStripes="1"');
    expect(table).toContain("<autoFilter");
    expect(table).not.toContain('hiddenButton="1"');
  }
  return { book, tables, first: book.Sheets[book.SheetNames[0]] };
}
const data = (ws: XLSX.WorkSheet) =>
  XLSX.utils.sheet_to_json<Array<string | number | Date | null>>(ws, { header: 1, defval: null });
function eqSubtotal(cell: XLSX.CellObject, expected: number) {
  expect(cell.f).toMatch(/^SUBTOTAL\(109,/);
  expect(cell.v).toBeCloseTo(expected, 7);
}
// Inspect the stored Excel day number directly: the reader's JS Date conversion
// otherwise applies the machine's local time zone.
const serial = (y: number, m: number, d: number) => Date.UTC(y, m, d) / 86400000 + 25569;
function checkSchedule(ws: XLSX.WorkSheet, rows: ScheduleRow[], dataStart: number, balanceCol: string) {
  for (const [i, r] of rows.entries()) {
    const n = i + dataStart;
    expect(ws[`A${n}`].v).toBe(r.month);
    expect(ws[`B${n}`]).toMatchObject({
      t: "n",
      v: serial(r.date.getFullYear(), r.date.getMonth(), r.date.getDate()),
    });
    for (const [c, v] of [
      ["C", r.payment],
      ["D", r.principal],
      ["E", r.interest],
      [balanceCol, r.balance],
    ] as const)
      expect(ws[`${c}${n}`]).toMatchObject({ t: "n", v });
  }
  for (const [c, key] of [
    ["C", "payment"],
    ["D", "principal"],
    ["E", "interest"],
  ] as const)
    eqSubtotal(
      ws[`${c}${dataStart + rows.length}`],
      rows.reduce((s, r) => s + r[key], 0),
    );
  expect(ws[`${balanceCol}${dataStart + rows.length}`]?.f).toBeUndefined();
}

describe("serialized Excel reports", () => {
  it("reconciles every payment and annual figure, the standalone Lead Sheet, and the mixed package", async () => {
    const [s, a, l, p] = await Promise.all(
      [
        buildScheduleWorkbook(schedule, evidence),
        buildAnnualWorkbook(annualRows(), evidence),
        buildFileWorkbook(file, false)!,
        buildFileWorkbook(file, true)!,
      ].map(reopen),
    );
    expect(schedule.length).toBe(61);
    checkSchedule(s.first, schedule, 2, "G");
    expect(s.tables[0]).toMatch(/<autoFilter ref="A1:J62"/);
    expect(s.first.F63?.f).toBeUndefined();
    expect(s.first.H63?.f).toBeUndefined();
    expect(s.first.J7.v).toContain("Principal event (after payment; #1; keep_maturity)");
    expect(s.first.F7.v).toBe(schedule[5].totalInterest);
    expect(s.first.I2.v).toContain("3.1250%");
    for (const [i, r] of annualRows().entries()) {
      const n = i + 2;
      expect(a.first[`A${n}`]).toMatchObject({ t: "n", v: serial(r.yearEnd.getFullYear(), 11, 31) });
      for (const [c, v] of [
        ["B", r.opening],
        ["C", r.principal],
        ["D", r.interest],
        ["E", r.interest + r.principal],
        ["F", r.closing],
      ] as const)
        expect(a.first[`${c}${n}`].v).toBe(v);
    }
    expect(a.first.B8?.f).toBeUndefined();
    expect(a.first.F8?.f).toBeUndefined();
    eqSubtotal(a.first.C8, 80000);
    expect(l.book.SheetNames).toEqual(["Lead Sheet"]);
    expect(p.first).toEqual(l.first);
    expect(l.first.E6.v).toBeCloseTo(65803.89, 2);
    expect(l.first.E6.v).toBeCloseTo(a.first.F2.v, 5);
    expect(l.first.H6.v).toBeCloseTo(2106.72, 2);
    expect(l.first.H6.v).toBeCloseTo(a.first.D2.v, 5);
    expect(l.first.C6.v).toBe(0.03125);
    expect(l.first.D6.z).toBe("mmmm d, yyyy");
    eqSubtotal(l.first.E8, l.first.E6.v + l.first.E7.v);
    expect(l.first.C8?.f).toBeUndefined();
    const lead = data(l.first);
    expect(lead.flat().join(" ")).toContain("callable on covenant violation");
    expect(lead.flat().join(" ")).toContain("ASPE 1510");
    expect(l.first.B6.v).toContain("master agreement");
    const op = lead.findIndex((r) => r[0] === "Total operating leases") + 1;
    eqSubtotal(l.first[`D${op}`], l.first[`D${op - 1}`].v);
    eqSubtotal(l.first[`F${op}`], 60000);
    expect(l.first[`E${op}`]?.f).toBeUndefined();
    expect(p.book.SheetNames.slice(1, 3)).toEqual(["Loan Repayment Summary", "Capital Lease Summary"]);
    const names = p.book.SheetNames.filter(n => !["Loan Repayment Summary", "Capital Lease Summary"].includes(n));
    expect(names.map((n) => n.split(" - ")[0])).toEqual([
      "Lead Sheet",
      "01 Detail",
      "01 Schedule",
      "02 Detail",
      "02 Schedule",
      "03 Detail",
    ]);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(6);
    expect(Math.max(...names.map((n) => n.length))).toBeLessThanOrEqual(31);
    const [loanWp, capWp] = buildFileWorkpapers(file);
    checkSchedule(p.book.Sheets[names[2]], loanWp.schedule!, 6, "F");
    checkSchedule(p.book.Sheets[names[4]], capWp.schedule!, 6, "F");
    for (const idx of [1, 2, 3, 4]) expect(p.book.Sheets[names[idx]].A3.v).toContain(loan.name);
    const rows = data(p.book.Sheets[names[1]]);
    expect(rows.find((r) => r[0] === "Down payment")?.[1]).toBe(-5000);
    expect(rows.find((r) => r[0] === "Stated rate")?.[1]).toBe(0.03125);
    expect(rows.flat()).toContain("Illustrative equipment charge");
    expect(rows.flat()).toContain("Illustrative borrowing limit");
    expect(data(p.book.Sheets[names[3]]).flat()).toContain("Future Minimum Lease Payments (Disclosure)");
    expect(data(p.book.Sheets[names[5]]).flat().join(" ")).toContain(
      "Straight-line rent expense for the year",
    );
  });
  it("keeps dates, full-precision negatives, zero rates, nulls, revision identifiers and event prose distinct", async () => {
    const custom: LoanExportMeta = {
      ...evidence,
      currentRevisionId: "000012",
      currentRevisionHash: "123.45",
      rateSpread: "0",
      activeEvents: [{ ...loan.activeEvents[0], source: "=1+1", reason: "$125.00" }],
      rateTimelineEvents: [
        {
          id: "0001",
          effectiveDate: "2026-06-01",
          benchmarkRate: "3.123456",
          spread: "-0.375",
          resultingRate: null,
          reason: "123.45",
          fetchedAt: "2026-05-31T23:00:00-07:00",
        },
      ],
    };
    const row = {
      ...schedule[0],
      date: new Date(2026, 2, 8, 23, 59),
      interest: -1.234567,
      contractualAnnualRate: 0,
    };
    const s = await reopen(
      buildScheduleWorkbook([row, { ...row, contractualAnnualRate: undefined }], custom),
    );
    expect(s.first.H2).toMatchObject({ t: "n", v: 0, z: "0.0000%" });
    expect(s.first.H3?.v).toBeUndefined();
    expect(s.first.E2).toMatchObject({ t: "n", v: -1.234567 });
    expect(s.first.E2.z).toContain("(");
    expect(s.first.B2).toMatchObject({ t: "n", v: serial(2026, 2, 8), z: "mmmm d, yyyy" });
    const ev = data(s.book.Sheets.Evidence);
    expect(ev.find((r) => r[0] === "Contract revision")?.[1]).toBe("000012");
    expect(ev.find((r) => r[0] === "Contract revision hash")?.[1]).toBe("123.45");
    const event = ev.find((r) => r[6] === "=1+1");
    expect(event?.[7]).toBe("$125.00");
    expect(event?.[0]).toBe(serial(2026, 5, 15));
    const rate = ev.find((r) => r[0] === "0001");
    expect(rate?.slice(7, 10)).toEqual([3.123456 / 100, -0.00375, null]);
    expect(rate?.[4]).toBe("2026-05-31T23:00:00-07:00");
    const a = await reopen(buildAnnualWorkbook([{ label: "2026", principal: 0, interest: 0, closing: 0 }]));
    expect(a.first.A2.v).toBe(2026);
    expect(a.first.B2?.v).toBeUndefined();
    expect(a.first.F2).toMatchObject({ t: "n", v: 0 });
    eqSubtotal(a.first.D3, 0);
    const operating = { ...file.loans[2], name: "$123.00", counterparty: "=1+1" };
    const pkg = await reopen(buildFileWorkbook({ ...file, loans: [operating] }, true)!);
    expect(pkg.first.A6).toMatchObject({ t: "s", v: "$123.00" });
    expect(pkg.first.B6).toMatchObject({ t: "s", v: "=1+1" });
    expect(pkg.book.SheetNames.length).toBe(2);
    expect(data(pkg.book.Sheets[pkg.book.SheetNames[1]]).flat()).toContain("=1+1");
  });
  it("retains day-one and annual journals and cumulative support in both standalone reports", async () => {
    const accounting = buildFairValueAccountingEntries({
      loan: { ...loan, fvDecision: "use_fv", fvRate: 7 },
      reportingFiscalYearEnd: file.fiscalYearEnd,
    });
    const meta = { ...evidence, fairValueAccountingEntries: accounting };
    expect(accounting.dayOne).toBeTruthy();
    expect(accounting.annualEntries.length).toBeGreaterThan(0);
    for (const [i, book] of [
      buildScheduleWorkbook(schedule, meta),
      buildAnnualWorkbook(annualRows(), meta),
    ].entries()) {
      const { book: b } = await reopen(book);
      const journal = data(b.Sheets["FV Journal Entries"]);
      expect(journal.flat()).toEqual(
        expect.arrayContaining(["Day-one fair value", "Annual effective-interest"]),
      );
      expect(b.Sheets["FV Journal Entries"].B2.z).toBe("mmmm d, yyyy");
      const lines = [...accounting.dayOne!.lines, ...accounting.annualEntries.flatMap((e) => e.lines)];
      expect(journal.slice(1, -1).map((r) => r.slice(3, 6))).toEqual(
        lines.map((l) => [l.account, l.debit || null, l.credit || null]),
      );
      const support = data(b.Sheets["FV Cumulative Support"]);
      expect(support.length).toBe(accounting.cumulativeSupport.length + 1);
      expect(b.Sheets["FV Cumulative Support"].B2.z).toBe("mmmm d, yyyy");
      expect(support[1].at(-1)).toBe(accounting.cumulativeSupport[0].remainingDiscount);
      expect(support[0]).toHaveLength(i === 0 ? 7 : 5);
    }
  });
  it("writes all six downloads and preserves the quick calculator’s smaller column sets", async () => {
    vi.mocked(saveAs).mockClear();
    await exportScheduleXlsx("Test", schedule, evidence);
    await exportAnnualXlsx("Test", annualRows(), evidence);
    await exportFileWorkpapersXlsx(file);
    await exportFileLeadSheetXlsx(file);
    await exportScheduleXlsx("", schedule, undefined, "Quick-Schedule.xlsx");
    await exportAnnualXlsx("", annualRows(), undefined, "Quick-Annual.xlsx");
    const calls = vi.mocked(saveAs).mock.calls;
    expect(calls.map((c) => c[1])).toEqual([
      "Test_Schedule.xlsx",
      "Test_Annual.xlsx",
      `${file.clientName}_Debt_Lease_Workpapers.xlsx`,
      `${file.clientName}_Debt_Lease_Summary.xlsx`,
      "Quick-Schedule.xlsx",
      "Quick-Annual.xlsx",
    ]);
    for (const [i, [blob]] of calls.slice(4).entries()) {
      const b = XLSX.read(await (blob as Blob).arrayBuffer(), {
        type: "array",
        bookFiles: true,
        cellDates: false,
      });
      const ws = b.Sheets[b.SheetNames[0]];
      expect(b.SheetNames).toEqual([i === 0 ? "Amortization Schedule" : "Annual Breakdown"]);
      expect(data(ws)[0]).toEqual(
        i === 0
          ? ["Month", "Date", "Payment", "Principal", "Interest", "Total Interest", "Balance", "Type"]
          : ["Fiscal Year", "Principal", "Interest", "Total"],
      );
      if (i === 0) checkSchedule(ws, schedule, 2, "G");
      else eqSubtotal(ws.B8, 80000);
      expect(Object.keys((b as any).files)).toContain("xl/tables/table1.xml");
    }
  });
});

describe("PDF export evidence", () => {
  it("passes the complete entry package and decision history to both PDF renderers", () => {
    const accounting = buildFairValueAccountingEntries({
      loan: { ...loan, fvDecision: "use_fv", fvRate: 7 },
      reportingFiscalYearEnd: file.fiscalYearEnd,
    });
    const meta = { ...evidence, fairValueAccountingEntries: accounting, fvDecisionHistory: {
      status: "current", reviewRequired: false, staleReasons: [], missingRequirements: [], history: [],
    } };
    const annual = annualRows();
    exportSchedulePdf(meta, schedule);
    exportAnnualPdf(meta.name, annual, meta);
    expect(renderSchedulePdf).toHaveBeenCalledWith(meta, schedule);
    expect(renderAnnualPdf).toHaveBeenCalledWith(meta.name, annual, meta);
  });
});
