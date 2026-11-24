import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { AssessmentAnswers, StraightLineAnswers } from "../components/capital-lease-assessment";
import {
  assessmentAnswersForReview, assessmentPaymentSaveValues,
  calculateOperatingLeaseAssessment, normalizedAssessmentAnswers,
} from "./lease-assessment-values";
import { buildFileSummary, buildLoanSummary, type OperatingLeaseSummary } from "./aspe-utils";
import { buildLoanWorkpaper, excelNumbers } from "./workpaper-export";
import { buildDisclosureModel } from "./disclosure-model";

const startDate = "2026-07-01";
const fiscalYearEnd = "2026-12-31";
const raw = {
  monthlyPayment: 1130, firstPaymentAmount: 2260, termMonths: 12,
  downPayment: 0, interestRate: 6, paymentAtBeginning: true,
  fairValue: 200000, economicLife: 10, paymentIncludesTax: true, taxRate: 13,
  leaseEndingTerms: { version: 1, kind: "none", amount: 0, settlementMonth: 12,
    basis: "stated", source: "Synthetic reviewed contract with no ending obligation",
    status: "reviewed", issues: [], discountRate: 6, implicitRate: null,
    taxTreatment: "recoverable", taxRate: 13, servicesMonthly: 100 },
} as AssessmentAnswers;
const straightLine: StraightLineAnswers = { freeRentMonths: 0, rentEscalationRate: 0,
  rentSteps: [], tenantImprovementAllowance: 0, otherInducements: 0,
  inducementReceivedInCash: false, camMonthly: 200 };

/** Same shared preview and save-value builders used by both wizard callers. */
function save(answers: AssessmentAnswers, sl = straightLine) {
  const preview = calculateOperatingLeaseAssessment({ answers, straightLine: sl }, startDate, fiscalYearEnd)!;
  return JSON.parse(JSON.stringify({
    id: "synthetic-operating", name: "Synthetic operating lease",
    ...assessmentPaymentSaveValues(answers, false),
    ...sl, principal: preview.totalLeasePayments,
    termMonths: answers.termMonths, termYears: 1, amortizationYears: 1,
    startDate, firstPaymentDate: startDate, isCapitalLease: false,
    downPayment: 0, paymentFrequency: "monthly", paymentTiming: "beginning",
  }));
}
const summary = (saved: ReturnType<typeof save>, date = new Date(2026, 11, 31)) =>
  buildLoanSummary(saved, date, fiscalYearEnd) as OperatingLeaseSummary;

describe("operating first rental across create, reopen, re-evaluation and reports", () => {
  it("uses the shared assessment preview in both create and re-evaluation callers", () => {
    const create = readFileSync(new URL("../pages/file-detail.tsx", import.meta.url), "utf8");
    const detail = readFileSync(new URL("../pages/loan-detail.tsx", import.meta.url), "utf8");
    expect(create.match(/calculateOperatingLeaseAssessment\(r, operatingStartDate, file.fiscalYearEnd\)/g)).toHaveLength(2);
    expect(detail).toContain("calculateOperatingLeaseAssessment(result, calendar.startDate, loan.fiscalYearEnd)");
    expect(detail).toContain("assessmentCalendarUpdate(result.answers, loan)");
    // Reopened cash and straight-line panels must both read the stored first rental.
    expect(detail.match(/firstPaymentAmount: loan.firstPaymentAmount == null \? null : Number\(loan.firstPaymentAmount\)/g)?.length)
      .toBeGreaterThanOrEqual(3);
    expect(create).toContain("principal: totalCommitment");
    expect(detail).toContain("slPreview?.totalLeasePayments");
  });

  it("normalizes once and retains 11,800 through save, reopen and no-edit re-evaluation", () => {
    const original = JSON.stringify(raw);
    const confirmed = normalizedAssessmentAnswers(raw);
    for (const answers of [raw, confirmed]) {
      const preview = calculateOperatingLeaseAssessment({ answers, straightLine }, startDate, fiscalYearEnd)!;
      expect(preview.totalLeasePayments).toBe(11800);
      expect(preview.monthlyStraightLineExpense).toBeCloseTo(983.333333, 6);
      const saved = save(answers);
      expect(saved).toMatchObject({ firstPaymentAmount: 1900, monthlyPayment: 900,
        principal: 11800, interestRate: 0, leaseAssessmentRate: 6 });
      const reopened = assessmentAnswersForReview({ ...confirmed, ...saved,
        interestRate: saved.leaseAssessmentRate, paymentIncludesTax: false });
      expect(reopened.firstPaymentAmount).toBe(2260);
      expect(save(reopened)).toEqual(saved);
      const report = summary(saved);
      expect(report.totalCommitment).toBe(11800);
      expect(report.monthlyStraightLineExpense).toBeCloseTo(11800 / 12);
      expect(report.deferredRentAtYearEnd).toBeCloseTo(500);
      expect(report.yearlyCash).toEqual([{ fiscalYear: 2026, amount: 6400 }, { fiscalYear: 2027, amount: 5400 }]);
      expect(report.yearlyStraightLine[0].amount).toBeCloseTo(5900);
      expect(report.yearlyPayments).toEqual([{ fiscalYear: 2027, label: "2027", amount: 5400 }]);
      expect(summary(saved, new Date(2025, 11, 31)).yearlyPayments.map(y => y.amount)).toEqual([6400, 5400]);
    }
    expect(JSON.stringify(raw)).toBe(original);
  });

  it("passes corrected annual cash, expense and deferred rent into file totals and PDF/Excel workpapers", () => {
    const saved = save(normalizedAssessmentAnswers(raw));
    const file = buildFileSummary([saved], fiscalYearEnd);
    expect(file.operatingLeaseTotalCommitment).toBe(11800);
    expect(file.totalStraightLineRentExpense).toBeCloseTo(5900);
    expect(file.totalOperatingLeaseCash).toBe(6400);
    // Preserve the existing reporting sign convention in this cash-stream fix.
    expect(file.deferredRentLiability).toBeCloseTo(500);
    const disclosure = buildDisclosureModel({ clientName: "Synthetic", fiscalYearEnd,
      agreements: [saved], summary: file, reportingTransitionsReady: true });
    expect(disclosure.balanceSheet.operatingLeases.commitments.current).toBe(11800);
    expect(disclosure.operations.straightLineRentExpense.current).toBeCloseTo(5900);
    expect(disclosure.cashFlows.operatingLeasePayments.current).toBe(6400);
    expect(disclosure.maturities).toContainEqual(expect.objectContaining({ label: "2027", operatingLeases: 5400 }));
    for (const cells of [undefined, excelNumbers]) {
      const wp = buildLoanWorkpaper(saved, { clientName: "Synthetic", fiscalYearEnd }, null, cells)!;
      const rows = wp.sections.flatMap(s => s.rows);
      expect(rows).toContainEqual(["First financing rental", cells ? 1900 : "$1,900.00"]);
      expect(rows).toContainEqual(["Total lease commitment", cells ? 11800 : "$11,800.00"]);
      expect(rows).toContainEqual(["Straight-line monthly expense", cells ? expect.closeTo(11800 / 12) : "$983.33"]);
      expect(rows).toContainEqual(["Cash rent for the year", cells ? 6400 : "$6,400.00"]);
      expect(rows).toContainEqual(["Straight-line rent expense for the year", cells ? expect.closeTo(5900) : "$5,900.00"]);
    }
  });

  it("preserves first-due-date commitment ownership while expense stays anchored to inception", () => {
    // Legacy calendars retain their historical first-due-date semantics.
    // Explicit ending evidence intentionally blocks irregular calendars.
    const saved = { ...save(raw), firstPaymentDate: "2027-01-01", leaseEndingTerms: null };
    const report = summary(saved);
    expect(report.yearlyPayments).toEqual([{ fiscalYear: 2027, label: "2027", amount: 11800 }]);
    expect(report.yearlyCash[0].amount).toBe(6400);
    expect(report.deferredRentAtYearEnd).toBeCloseTo(500);
  });

  it("shares stepped, free-rent and inducement amounts between preview, reopened reports and workpapers", () => {
    const sl = { ...straightLine, freeRentMonths: 2, rentEscalationRate: 50,
      rentSteps: [{ fromYear: 1, toYear: 1, monthlyRent: 950 }],
      tenantImprovementAllowance: 600, otherInducements: 200 };
    const preview = calculateOperatingLeaseAssessment({ answers: raw, straightLine: sl }, startDate, fiscalYearEnd)!;
    const saved = save(raw, sl);
    const report = summary(saved, new Date(2025, 11, 31));
    expect(preview.totalLeasePayments).toBe(10450); // 0, 0, 1900, nine × 950
    expect(saved.principal).toBe(10450);
    expect(report.totalCommitment).toBe(preview.totalLeasePayments);
    expect(report.yearlyPayments.reduce((sum, y) => sum + y.amount, 0)).toBe(10450);
    expect(report.monthlyStraightLineExpense).toBe(preview.monthlyStraightLineExpense);
    const wp = buildLoanWorkpaper(saved, { clientName: "Synthetic", fiscalYearEnd })!;
    expect(wp.sections.flatMap(s => s.rows)).toContainEqual(["Total lease commitment", "$10,450.00"]);
  });

  it.each([null, undefined, 0])("keeps nullable and zero first rentals distinct after save (%s)", firstPaymentAmount => {
    const answers = { ...normalizedAssessmentAnswers(raw), firstPaymentAmount, leaseEndingTerms: null };
    const saved = save(answers);
    const expected = firstPaymentAmount === 0 ? 9900 : 10800;
    expect(summary(saved).totalCommitment).toBe(expected);
    expect(saved.principal).toBe(expected);
  });
});
