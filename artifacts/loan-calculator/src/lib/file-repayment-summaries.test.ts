import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildFileRepaymentSummaries } from "./file-repayment-summaries";
import { buildFileWorkbook } from "./file-report-workbook";
import { buildLoanSummary } from "./aspe-utils";
import { excelNumbers, buildFileWorkpapers } from "./workpaper-export";
import { file, loan } from "./excel-example-data";
import { parseISO } from "date-fns";

describe("consolidated repayment disclosure support", () => {
  it("aggregates loans and capital leases separately and reconciles future interest to liability", () => {
    const capital = file.loans.find(l => l.isCapitalLease)!;
    const input = { ...file, loans: [...file.loans,
      { ...loan, id: "second-loan", name: "Another loan", principal: 45000, activeEvents: [] },
      { ...capital, id: "second-lease", name: "Another capital lease" }] };
    const [loans, leases] = buildFileRepaymentSummaries(input, excelNumbers);
    expect(loans.typeLabel).toBe("Loan Repayment Summary");
    expect(leases.typeLabel).toBe("Capital Lease Summary");
    expect(loans.sections[0].rows.map(r => r[0])).toEqual(["2027", "2028", "2029", "2030", "2031", "Thereafter", "Total"]);
    const individual = input.loans.map(l => buildLoanSummary(l, parseISO(file.fiscalYearEnd), file.fiscalYearEnd))
      .filter(s => s && !("monthlyStraightLineExpense" in s));
    const loanTotal = individual.filter(s => !s!.isCapitalLease)
      .reduce((sum, s) => sum + s!.yearlyPrincipal.reduce((n, row) => n + row.amount, 0), 0);
    expect(loans.sections[0].rows.at(-1)![1]).toBeCloseTo(loanTotal, 6);
    const cl = individual.filter(s => s!.isCapitalLease && "yearlyBlended" in s!);
    const rows = leases.sections[1].rows;
    const payments = Number(rows.at(-3)![1]), interest = Number(rows.at(-2)![1]), liability = Number(rows.at(-1)![1]);
    expect(payments + interest).toBeCloseTo(liability, 6);
    expect(liability).toBeCloseTo(cl.reduce((n, s) => n + s!.balanceAtYearEnd, 0), 6);
    expect(Number(leases.sections[0].rows.at(-1)![1])).toBeCloseTo(liability, 6);
  });
  it("uses fixed fiscal years, includes zero years and thereafter, and retains maturity balloons", () => {
    const input = { ...file, fiscalYearEnd: "2026-09-30", loans: [{
      ...loan, id: "future-balloon", startDate: "2030-01-01", firstPaymentDate: "2030-02-01",
      termYears: 7, amortizationYears: 10, activeEvents: [], covenantViolation: false,
    }] };
    const [summary] = buildFileRepaymentSummaries(input, excelNumbers);
    const rows = summary.sections[0].rows;
    expect(rows.slice(0, 3)).toEqual([["2027", 0], ["2028", 0], ["2029", 0]]);
    expect(Number(rows[5][1])).toBeGreaterThan(0);
    const individual = buildLoanSummary(input.loans[0], parseISO(input.fiscalYearEnd), input.fiscalYearEnd)!;
    expect(rows.at(-1)![1]).toBeCloseTo("yearlyPrincipal" in individual
      ? individual.yearlyPrincipal.reduce((n, r) => n + r.amount, 0) : -1, 6);
  });
  it("excludes operating leases and omits summaries for absent agreement types", () => {
    const operating = file.loans.find(l => !l.isCapitalLease && l.termMonths)!;
    expect(buildFileRepaymentSummaries({ ...file, loans: [operating] }, excelNumbers)).toEqual([]);
    expect(buildFileRepaymentSummaries({ ...file, loans: [loan] }, excelNumbers).map(s => s.typeLabel))
      .toEqual(["Loan Repayment Summary"]);
    expect(buildFileRepaymentSummaries({ ...file, loans: [] })).toEqual([]);
  });
  it("writes numeric summary sheets before details, preserves individual workpapers and standalone lead sheets", async () => {
    const before = buildFileWorkpapers(file);
    const wb = buildFileWorkbook(file, true)!;
    for (const sheet of wb.worksheets) {
      expect(sheet.getCell("A1").value).toBe(`Client name: ${file.clientName}`);
      expect(sheet.getCell("A2").value).toBe("Year-end: December 31, 2026");
      expect(sheet.getCell("A1").font.bold).toBe(true);
      expect(sheet.getCell("A2").font.bold).toBe(true);
      expect(sheet.getCell("A1").alignment.horizontal).toBe("left");
      expect(sheet.pageSetup.printTitlesRow).toBe("1:3");
    }
    expect(wb.worksheets.slice(0, 3).map(s => s.name)).toEqual(["Lead Sheet", "Loan Repayment Summary", "Capital Lease Summary"]);
    const book = XLSX.read(await wb.xlsx.writeBuffer(), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Array<string | number>>(book.Sheets["Capital Lease Summary"], { header: 1 });
    const amount = (label: string) => Number(rows.find(r => r[0] === label)![1]);
    expect(amount("Total minimum lease payments") + amount("Less: amount representing interest"))
      .toBeCloseTo(amount("Capital lease liability at year end"), 6);
    const interest = rows.find(r => r[0] === "Less: amount representing interest")![1];
    expect(typeof interest).toBe("number");
    expect(interest).toBeLessThan(0);
    expect(buildFileWorkbook(file, false)!.worksheets.map(s => s.name)).toEqual(["Lead Sheet"]);
    expect(buildFileWorkpapers(file)).toEqual(before);
  });
});
