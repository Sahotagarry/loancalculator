import { describe, it, expect } from "vitest";
import {
  isZeroRateFvCandidate,
  needsFvAssessment,
  needsUrgentFvAssessment,
} from "./fv-assessment";
import { calculateAmortization, calculateFairValueSchedule } from "@workspace/amortization";

const loan = (overrides: Partial<Parameters<typeof needsFvAssessment>[0]> = {}) => ({
  isCapitalLease: false,
  interestRate: 0,
  monthlyPayment: null,
  termMonths: null,
  ...overrides,
});

describe("0% boundary for the ASPE 3856 FV workflow", () => {
  it("flags a genuine 0% loan as a zero-rate FV candidate", () => {
    const l = loan();
    expect(isZeroRateFvCandidate(l)).toBe(true);
    expect(needsFvAssessment(l)).toBe(true);
    expect(needsUrgentFvAssessment(l)).toBe(true);
  });

  it("excludes 0% operating leases (monthlyPayment + termMonths present)", () => {
    const l = loan({ monthlyPayment: 2500, termMonths: 60 });
    expect(isZeroRateFvCandidate(l)).toBe(false);
    expect(needsFvAssessment(l)).toBe(false);
    expect(needsUrgentFvAssessment(l)).toBe(false);
  });

  it("a 0% loan with only monthlyPayment or only termMonths is still a loan", () => {
    expect(isZeroRateFvCandidate(loan({ monthlyPayment: 2500 }))).toBe(true);
    expect(isZeroRateFvCandidate(loan({ termMonths: 60 }))).toBe(true);
  });

  it("excludes capital leases at 0%", () => {
    const l = loan({ isCapitalLease: true });
    expect(isZeroRateFvCandidate(l)).toBe(false);
    expect(needsFvAssessment(l)).toBe(false);
  });

  it("keeps existing low-rate behaviour for positive rates", () => {
    expect(needsFvAssessment(loan({ interestRate: 0.5 }))).toBe(true);
    expect(needsUrgentFvAssessment(loan({ interestRate: 0.5 }))).toBe(true);
    expect(needsUrgentFvAssessment(loan({ interestRate: 1 }))).toBe(false);
    expect(needsFvAssessment(loan({ interestRate: 2.99 }))).toBe(true);
    expect(needsFvAssessment(loan({ interestRate: 3 }))).toBe(false);
    expect(needsFvAssessment(loan({ interestRate: 6 }))).toBe(false);
  });

  it("positive-rate leases are unaffected by the zero-rate carve-out", () => {
    // A 2% capital lease still gets the low-rate warning, as before.
    expect(needsFvAssessment(loan({ isCapitalLease: true, interestRate: 2 }))).toBe(true);
  });
});

describe("fair value schedule at a 0% contractual rate", () => {
  it("discounts a 0% loan's payments at the suggested market rate", () => {
    const contractual = calculateAmortization(
      120000, // financed amount
      0, // 0% contractual rate
      5, // amortization years
      5, // term years
      new Date(2025, 0, 15),
      0,
      [],
      0,
      "monthly",
      null,
    );
    // At 0% every payment is pure principal and interest totals zero.
    expect(contractual.schedule.reduce((s, r) => s + r.interest, 0)).toBeCloseTo(0, 2);

    const fv = calculateFairValueSchedule(contractual.schedule, 9.2, "monthly");
    // Discounted fair value must be below face, producing a day-one discount.
    expect(fv.fairValue).toBeGreaterThan(0);
    expect(fv.fairValue).toBeLessThan(120000);
    // The discount fully unwinds as imputed interest over the term.
    expect(fv.totalInterest).toBeCloseTo(120000 - fv.fairValue, 1);
    // Payments are unchanged (effective-interest method).
    expect(fv.totalPayment).toBeCloseTo(
      contractual.schedule.reduce((s, r) => s + r.payment, 0),
      1,
    );
  });
});
