import { describe, it, expect } from "vitest";
import { calculateBookedSchedule, buildLoanSummary, usesFairValue, effectiveLoanRate } from "./aspe-utils";

/* Regression coverage: a malformed persisted fvRate must never silently
   corrupt the booked schedule that backs loan detail, file views,
   workpapers, and exports — it falls back to the contractual schedule. */

const base = {
  principal: 100000,
  downPayment: 0,
  interestRate: 2,
  amortizationYears: 5,
  termYears: 5,
  startDate: "2024-01-01",
};

describe("calculateBookedSchedule FV rate guarding", () => {
  it("books the effective-interest schedule when use_fv has a valid rate", () => {
    const booked = calculateBookedSchedule({ ...base, fvDecision: "use_fv", fvRate: 7 });
    expect(booked.usedFairValue).toBe(true);
    expect(booked.fairValue).not.toBeNull();
    expect(booked.fairValue!).toBeLessThan(100000);
  });

  it("recomputes when the rate is overridden", () => {
    const at7 = calculateBookedSchedule({ ...base, fvDecision: "use_fv", fvRate: 7 });
    const at10 = calculateBookedSchedule({ ...base, fvDecision: "use_fv", fvRate: 10 });
    expect(at10.fairValue!).toBeLessThan(at7.fairValue!);
    expect(at10.totalInterest).toBeGreaterThan(at7.totalInterest);
  });

  it("falls back to the contractual schedule for malformed persisted rates", () => {
    const contractual = calculateBookedSchedule({ ...base });
    for (const bad of ["Infinity", "-Infinity", "abc", "0", "-3", NaN, Infinity, 0, -1] as const) {
      const booked = calculateBookedSchedule({ ...base, fvDecision: "use_fv", fvRate: bad });
      expect(booked.usedFairValue).toBe(false);
      expect(booked.fairValue).toBeNull();
      expect(booked.totalInterest).toBeCloseTo(contractual.totalInterest, 6);
      // No NaN/Infinity anywhere in the schedule.
      for (const row of booked.schedule) {
        expect(Number.isFinite(row.payment)).toBe(true);
        expect(Number.isFinite(row.interest)).toBe(true);
        expect(Number.isFinite(row.balance)).toBe(true);
      }
    }
  });

  it("keeps the contractual schedule when no FV decision was made, even with a rate saved", () => {
    const booked = calculateBookedSchedule({ ...base, fvRate: 7 });
    expect(booked.usedFairValue).toBe(false);
    expect(booked.fairValue).toBeNull();
  });
});

describe("usesFairValue / effectiveLoanRate (display + workpaper resolver)", () => {
  it("labels FV and returns the FV rate only for a valid rate with use_fv", () => {
    const loan = { fvDecision: "use_fv", fvRate: 7, interestRate: 2 };
    expect(usesFairValue(loan)).toBe(true);
    expect(effectiveLoanRate(loan)).toBe(7);
  });

  it("falls back to the contractual rate and no FV label for malformed persisted rates", () => {
    for (const bad of ["Infinity", "abc", NaN, Infinity, 0, -1, null, undefined]) {
      const loan = { fvDecision: "use_fv", fvRate: bad as any, interestRate: 2 };
      expect(usesFairValue(loan)).toBe(false);
      expect(effectiveLoanRate(loan)).toBe(2);
    }
  });

  it("never applies the FV rate without a use_fv decision", () => {
    expect(effectiveLoanRate({ fvDecision: "trivial", fvRate: 7, interestRate: 2 })).toBe(2);
    expect(effectiveLoanRate({ fvRate: 7, interestRate: 2 })).toBe(2);
  });
});

describe("buildLoanSummary with malformed FV rates", () => {
  const loan = {
    id: "l1",
    name: "Test loan",
    counterparty: null,
    description: "",
    isCapitalLease: false,
    principal: 100000,
    downPayment: 0,
    interestRate: 2,
    amortizationYears: 5,
    termYears: 5,
    startDate: "2024-01-01",
    paymentFrequency: "monthly",
    fvDecision: "use_fv",
  };
  const reportYearEnd = new Date(2024, 11, 31);

  it("reports finite contractual figures when the persisted FV rate is malformed", () => {
    for (const bad of ["Infinity", NaN, 0, -3]) {
      const summary = buildLoanSummary({ ...loan, fvRate: bad as any } as any, reportYearEnd, "2024-12-31");
      expect(summary).not.toBeNull();
      // Falls back to the contractual rate — never "interest at Infinity%".
      expect((summary as any).interestRate).toBe(2);
      expect(Number.isFinite((summary as any).balanceAtYearEnd)).toBe(true);
    }
  });

  it("uses the FV rate when it is valid", () => {
    const summary = buildLoanSummary({ ...loan, fvRate: 7 } as any, reportYearEnd, "2024-12-31");
    expect((summary as any).interestRate).toBe(7);
  });
});
