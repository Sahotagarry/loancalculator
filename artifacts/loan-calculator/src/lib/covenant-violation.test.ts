import { describe, it, expect } from "vitest";
import { parseISO } from "date-fns";
import { buildLoanSummary, buildFileSummary, type LoanSummary } from "./aspe-utils";

const fyEnd = "2026-02-28";
const reportYearEnd = parseISO(fyEnd);

const baseLoan = {
  id: "loan-1",
  name: "Test Loan",
  principal: 100000,
  interestRate: 6,
  amortizationYears: 5,
  termYears: 5,
  startDate: "2024-03-01",
  paymentFrequency: "monthly",
  isCapitalLease: false,
};

describe("covenant violation reclassification", () => {
  it("without violation, splits current and long-term normally", () => {
    const s = buildLoanSummary({ ...baseLoan }, reportYearEnd, fyEnd) as LoanSummary;
    expect(s).toBeTruthy();
    expect(s.covenantViolation).toBe(false);
    expect(s.currentPortion).toBeGreaterThan(0);
    expect(s.longTermPortion).toBeGreaterThan(0);
    expect(s.scheduledWithinOneYear).toBeCloseTo(s.currentPortion, 6);
    expect(s.scheduledBeyondOneYear).toBe(0);
    expect(s.currentPortion + s.longTermPortion).toBeCloseTo(s.balanceAtYearEnd, 2);
  });

  it("with violation, entire balance is current with within/beyond split", () => {
    const normal = buildLoanSummary({ ...baseLoan }, reportYearEnd, fyEnd) as LoanSummary;
    const s = buildLoanSummary({ ...baseLoan, covenantViolation: true }, reportYearEnd, fyEnd) as LoanSummary;
    expect(s.covenantViolation).toBe(true);
    expect(s.currentPortion).toBeCloseTo(s.balanceAtYearEnd, 6);
    expect(s.longTermPortion).toBe(0);
    expect(s.scheduledWithinOneYear).toBeCloseTo(normal.currentPortion, 6);
    expect(s.scheduledBeyondOneYear).toBeCloseTo(normal.longTermPortion, 6);
    expect(s.scheduledWithinOneYear + s.scheduledBeyondOneYear).toBeCloseTo(s.currentPortion, 2);
  });

  it("violation does not change the outstanding balance", () => {
    const normal = buildLoanSummary({ ...baseLoan }, reportYearEnd, fyEnd) as LoanSummary;
    const violated = buildLoanSummary({ ...baseLoan, covenantViolation: true }, reportYearEnd, fyEnd) as LoanSummary;
    expect(violated.balanceAtYearEnd).toBeCloseTo(normal.balanceAtYearEnd, 6);
  });

  it("applies to capital leases too", () => {
    const lease = {
      ...baseLoan,
      id: "lease-1",
      name: "Test Capital Lease",
      isCapitalLease: true,
      covenantViolation: true,
    };
    const s = buildLoanSummary(lease, reportYearEnd, fyEnd) as LoanSummary;
    expect(s.covenantViolation).toBe(true);
    expect(s.currentPortion).toBeCloseTo(s.balanceAtYearEnd, 6);
    expect(s.longTermPortion).toBe(0);
    expect(s.scheduledBeyondOneYear).toBeGreaterThan(0);
  });

  it("file summary totals reflect the reclassification", () => {
    const loans = [
      { ...baseLoan, id: "a" },
      { ...baseLoan, id: "b", covenantViolation: true },
    ];
    const normalOnly = buildFileSummary([loans[0]], fyEnd);
    const mixed = buildFileSummary(loans, fyEnd);
    const violated = mixed.loans.find((l) => l.id === "b")!;
    expect(mixed.loanCurrent).toBeCloseTo(normalOnly.loanCurrent + violated.balanceAtYearEnd, 2);
    expect(mixed.loanLongTerm).toBeCloseTo(normalOnly.loanLongTerm, 2);
    expect(mixed.totalDebt).toBeCloseTo(normalOnly.totalDebt + violated.balanceAtYearEnd, 2);
  });

  it("operating leases are unaffected by the flag", () => {
    const op = {
      id: "op-1",
      name: "Operating Lease",
      principal: 0,
      interestRate: 0,
      amortizationYears: 0,
      termYears: 0,
      startDate: "2025-03-01",
      isCapitalLease: false,
      monthlyPayment: 2000,
      termMonths: 36,
      covenantViolation: true,
    };
    const summary = buildFileSummary([op], fyEnd);
    expect(summary.operatingLeaseCount).toBe(1);
    expect(summary.loanCurrent).toBe(0);
    expect(summary.leaseCurrent).toBe(0);
  });
});
