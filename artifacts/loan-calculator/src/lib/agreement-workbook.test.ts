import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildAgreementWorkbook } from "./agreement-workbook";
import { buildLoanWorkpaper, type WorkpaperLoanInput, type Workpaper } from "./workpaper-export";

const meta = { clientName: "Illustrative client", fiscalYearEnd: "2026-09-30" };
function agreement(overrides: Partial<WorkpaperLoanInput> = {}) {
  return buildLoanWorkpaper({
    name: "Equipment financing example", counterparty: "Example lender", principal: "85000",
    interestRate: "5.25", amortizationYears: 5, termYears: 5, termMonths: 60, downPayment: null,
    startDate: "2026-05-01", firstPaymentDate: "2026-06-01", paymentFrequency: "monthly",
    paymentTiming: "end", interestMethod: "actual_365", isCapitalLease: false, ioMonths: 0,
    balloonPayment: "0", collateralType: "equipment", collateralDescription: "Equipment",
    securityClauses: ["Specific charge on equipment"],
    fvDecisionHistory: { status: "incomplete", reviewRequired: true, staleReasons: [], missingRequirements: ["treatment"], history: [] },
    ...overrides,
  } as WorkpaperLoanInput, meta)!;
}

describe("individual Excel workpaper", () => {
  it("opens on the booked schedule with four filtered tables and the reference tab order", async () => {
    const wp = agreement();
    const book = buildAgreementWorkbook(wp);
    const ws = book.worksheets[0];
    expect(ws.getTables()).toHaveLength(4);
    const roundTrip = XLSX.read(await book.xlsx.writeBuffer(), { type: "buffer", cellNF: true, bookFiles: true }) as XLSX.WorkBook & {
      files: Record<string, { content: Uint8Array }>;
    };
    for (let i = 1; i <= 4; i++) {
      const tableXml = new TextDecoder().decode(roundTrip.files[`xl/tables/table${i}.xml`].content);
      expect(tableXml).toContain('name="TableStyleMedium9"');
      expect(tableXml).toContain('showRowStripes="1"');
      expect(tableXml).toContain("<autoFilter");
    }
    expect(roundTrip.SheetNames).toEqual(["Schedule", "Terms & Security", "Draft Note Disclosure",
      "Fair Value Assessment (ASPE 3856)".slice(0,31), "Fair Value Decision Status & History".slice(0,31)]);
    const sheet = roundTrip.Sheets.Schedule;
    for (const [addr, expected] of [["H1", "Principal Repayments"], ["H12", "Continuity"], ["H23", "Balance Sheet Presentation"]] as const) {
      expect(sheet[addr]?.v).toContain(expected);
    }
    expect(sheet["!merges"]).toHaveLength(3);
    expect(sheet.A61.v).toBe(60);
    expect(sheet.B2).toMatchObject({ t: "n", z: "mmmm d, yyyy" });
    expect(sheet.D2.v).toBe(Number(wp.schedule![0].principal.toFixed(2)));
    expect(sheet.I18.t).toBe("n");
    expect(sheet.I18.v).toBeLessThan(0);
    expect(sheet.I10.f).toMatch(/^SUBTOTAL\(109,/);
    expect(sheet.I10.v).toBeCloseTo([5, 6, 7, 8, 9].reduce((n, r) => n + sheet[`I${r}`].v, 0), 2);
    const terms = roundTrip.Sheets["Terms & Security"];
    expect(terms.A21.v).toContain("Security & Related Assets");
    expect(terms.B6).toMatchObject({t: "n", z: "0.00%"});
    expect(terms.B6.v).toBeCloseTo(.0525);
  });
  it("retains thereafter, covenants, notes and additional supporting sections without colliding", () => {
    const wp = agreement({ termYears: 8, termMonths: 96, amortizationYears: 8, covenantViolation: true });
    wp.sections.find(s => s.title.startsWith("Continuity"))!.notes = ["Reconciliation note"];
    const b = buildAgreementWorkbook(wp);
    const ws = b.worksheets[0];
    const text = JSON.stringify(ws.getSheetValues());
    for (const v of ["Thereafter", "Reconciliation note", "callable", "covenant was violated"]) expect(text).toContain(v);
    expect(ws.getCell("A97").value).toBe(96);
    for (const s of wp.sections) expect(JSON.stringify(b.worksheets.map(w => w.getSheetValues()))).toContain(s.title);
  });
  it("handles operating leases without inventing a debt schedule", () => {
    const wp = agreement({ principal: "60000", monthlyPayment: "1000", interestRate: "0", isCapitalLease: false });
    expect(wp.schedule).toBeNull();
    const names = buildAgreementWorkbook(wp).worksheets.map(w => w.name);
    expect(names).not.toContain("Schedule");
    expect(names.some(n => n.startsWith("Future Minimum Lease Payments"))).toBe(true);
    expect(names.some(n => n.startsWith("Rent Expense"))).toBe(true);
  });
  it("preserves a capital lease’s classification and minimum payment support", () => {
    const wp = agreement({ isCapitalLease: true, monthlyPayment: "1700", fairValue: "85000" });
    expect(buildAgreementWorkbook(wp).worksheets.map(s => s.name))
      .toEqual(expect.arrayContaining(["Schedule", "Lease Classification (ASPE 3065)".slice(0,31), "Draft Note Disclosure"]));
    expect(wp.sections.some(s => s.title.startsWith("Future Minimum Lease Payments"))).toBe(true);
  });
  it("keeps arbitrary client-supplied text as text, including leading equals signs", () => {
    const wp: Workpaper = { ...agreement(), sections: [{ title: "Terms", head: ["Item", "Detail"], rows: [["Identifier", "=1+1"]] }] };
    expect(buildAgreementWorkbook(wp).getWorksheet("Terms & Security")!.getCell("B4").value).toBe("=1+1");
  });
});
