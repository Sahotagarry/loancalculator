import { describe, it, expect } from "vitest";
import {
  calculateAmortization,
  calculateFairValueSchedule,
  computeFvAdjustment,
  suggestFvDecision,
} from "./index";

const START = new Date(2024, 0, 1);

describe("calculateAmortization", () => {
  it("computes the standard blended payment for a term shorter than amortization", () => {
    const result = calculateAmortization(100000, 6, 25, 5, START);

    // Standard mortgage payment: P*r / (1 - (1+r)^-n), r = 0.5%/mo, n = 300.
    expect(result.monthlyPayment).toBeCloseTo(644.3, 1);
    // Term is 5 years => 60 monthly periods.
    expect(result.schedule).toHaveLength(60);
    // First period interest is exactly the opening balance * periodic rate.
    expect(result.schedule[0].interest).toBeCloseTo(500, 6);
    expect(result.schedule[0].principal).toBeCloseTo(result.monthlyPayment - 500, 6);
    // A 5-year term on a 25-year amortization leaves a large residual balance.
    expect(result.schedule[59].balance).toBeGreaterThan(0);
    // totalPayment is principal plus total interest.
    expect(result.totalPayment).toBeCloseTo(100000 + result.totalInterest, 6);
  });

  it("keeps principal + interest equal to the payment every period", () => {
    const result = calculateAmortization(100000, 6, 25, 5, START);
    for (const row of result.schedule) {
      expect(row.principal + row.interest).toBeCloseTo(row.payment, 6);
    }
  });

  it("handles a zero interest rate with straight principal repayment", () => {
    const result = calculateAmortization(12000, 0, 1, 1, START);

    expect(result.monthlyPayment).toBeCloseTo(1000, 6);
    expect(result.totalInterest).toBeCloseTo(0, 6);
    expect(result.schedule).toHaveLength(12);
    expect(result.schedule[11].balance).toBeCloseTo(0, 6);
    for (const row of result.schedule) {
      expect(row.interest).toBeCloseTo(0, 6);
      expect(row.principal).toBeCloseTo(1000, 6);
    }
  });

  it("services interest-only during the initial IO window without amortizing principal", () => {
    const result = calculateAmortization(100000, 6, 25, 5, START, 12);

    expect(result.schedule[0].isInterestOnly).toBe(true);
    expect(result.schedule[0].principal).toBeCloseTo(0, 6);
    expect(result.schedule[0].interest).toBeCloseTo(500, 6);
    // Balance is unchanged through the whole IO window.
    expect(result.schedule[11].isInterestOnly).toBe(true);
    expect(result.schedule[11].balance).toBeCloseTo(100000, 6);
    // First period after the IO window begins amortizing principal.
    expect(result.schedule[12].isInterestOnly).toBe(false);
    expect(result.schedule[12].principal).toBeGreaterThan(0);
  });

  it("lowers the periodic payment when a balloon is owed at maturity", () => {
    const withoutBalloon = calculateAmortization(100000, 6, 5, 5, START);
    const withBalloon = calculateAmortization(100000, 6, 5, 5, START, 0, [], 20000);

    expect(withBalloon.monthlyPayment).toBeLessThan(withoutBalloon.monthlyPayment);
  });

  it("treats specified calendar months as interest-only (seasonal IO)", () => {
    // July (month index 6) is the 7th monthly period of a Jan-start term.
    const result = calculateAmortization(100000, 6, 25, 1, START, 0, [6]);

    expect(result.schedule[6].isInterestOnly).toBe(true);
    expect(result.schedule[6].principal).toBeCloseTo(0, 6);
    expect(result.schedule[6].payment).toBeCloseTo(result.schedule[6].interest, 6);
    // A non-seasonal month still amortizes principal.
    expect(result.schedule[5].isInterestOnly).toBe(false);
    expect(result.schedule[5].principal).toBeGreaterThan(0);
  });

  it("scales the number of periods with the payment frequency", () => {
    expect(calculateAmortization(50000, 5, 10, 1, START, 0, [], 0, "weekly").schedule).toHaveLength(52);
    expect(calculateAmortization(50000, 5, 10, 1, START, 0, [], 0, "bi-weekly").schedule).toHaveLength(26);
    expect(calculateAmortization(50000, 5, 10, 1, START, 0, [], 0, "monthly").schedule).toHaveLength(12);
  });
});

describe("calculateFairValueSchedule", () => {
  it("discounts below-market contractual cash flows below face value", () => {
    const contractual = calculateAmortization(100000, 2, 5, 5, START);
    const fv = calculateFairValueSchedule(contractual.schedule, 7);

    // Below-market payments discounted at the market rate sit below the face amount.
    expect(fv.fairValue).toBeLessThan(100000);
    expect(fv.fairValue).toBeGreaterThan(0);
    expect(fv.schedule).toHaveLength(contractual.schedule.length);
  });

  it("holds the contractual payment fixed and only re-splits principal vs interest", () => {
    const contractual = calculateAmortization(100000, 2, 5, 5, START);
    const fv = calculateFairValueSchedule(contractual.schedule, 7);

    for (let i = 0; i < fv.schedule.length; i++) {
      // Payment is unchanged from the contractual schedule.
      expect(fv.schedule[i].payment).toBeCloseTo(contractual.schedule[i].payment, 6);
      // principal + interest still equals the payment.
      expect(fv.schedule[i].principal + fv.schedule[i].interest).toBeCloseTo(
        fv.schedule[i].payment,
        6,
      );
    }
    // Opening interest accretes at the market rate on the fair value.
    expect(fv.schedule[0].interest).toBeCloseTo((fv.fairValue * 7) / 100 / 12, 4);
    // The FV schedule amortizes back to the same residual balance.
    const contractualFinal = contractual.schedule[contractual.schedule.length - 1].balance;
    expect(fv.schedule[fv.schedule.length - 1].balance).toBeCloseTo(contractualFinal, 2);
  });
});

describe("computeFvAdjustment", () => {
  it("returns the day-one discount for a below-market loan", () => {
    const adjustment = computeFvAdjustment({
      principal: 100000,
      contractualRate: 2,
      fvRate: 7,
      amortizationYears: 5,
      termYears: 5,
      startDate: START,
    });

    expect(adjustment).toBeGreaterThan(0);
    expect(adjustment).toBeLessThan(100000);

    // Independent oracle: adjustment must equal principal minus the present value
    // of the contractual cash flows discounted at the market rate.
    const contractual = calculateAmortization(100000, 2, 5, 5, START);
    const r = 7 / 100 / 12;
    let pv = 0;
    contractual.schedule.forEach((row, idx) => {
      pv += row.payment / Math.pow(1 + r, idx + 1);
    });
    const finalBalance = contractual.schedule[contractual.schedule.length - 1].balance;
    pv += finalBalance / Math.pow(1 + r, contractual.schedule.length);
    expect(adjustment).toBeCloseTo(100000 - pv, 2);
  });

  it("is approximately zero when the contractual rate already equals the market rate", () => {
    const adjustment = computeFvAdjustment({
      principal: 100000,
      contractualRate: 7,
      fvRate: 7,
      amortizationYears: 5,
      termYears: 5,
      startDate: START,
    });

    expect(Math.abs(adjustment)).toBeLessThan(1);
  });
});

describe("suggestFvDecision", () => {
  it("returns null when the adjustment is unknown", () => {
    expect(suggestFvDecision(null, 500, 5000)).toBeNull();
    expect(suggestFvDecision(undefined, 500, 5000)).toBeNull();
  });

  it("flags trivial adjustments below the trivial threshold", () => {
    expect(suggestFvDecision(100, 500, 5000)).toBe("trivial");
  });

  it("recommends fair value once the adjustment reaches materiality", () => {
    expect(suggestFvDecision(6000, 500, 5000)).toBe("use_fv");
    // Uses the absolute value, so a large negative adjustment still triggers use_fv.
    expect(suggestFvDecision(-6000, 500, 5000)).toBe("use_fv");
  });

  it("marks adjustments between the thresholds as immaterial", () => {
    expect(suggestFvDecision(1000, 500, 5000)).toBe("immaterial");
  });

  it("returns null when no thresholds are configured", () => {
    expect(suggestFvDecision(1000, null, null)).toBeNull();
  });
});
