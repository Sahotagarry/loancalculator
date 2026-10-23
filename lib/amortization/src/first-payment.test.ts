import { describe, expect, it } from "vitest";
import { calculateAmortization, computeFvAdjustment } from "./index";

const START = new Date(2024, 0, 1);

describe("contractual first payment amount", () => {
  it("leaves the schedule identical when not supplied", () => {
    const legacy = calculateAmortization(50000, 6, 5, 5, START, 0, [], 0, "monthly", 980);
    const withNull = calculateAmortization(
      50000, 6, 5, 5, START, 0, [], 0, "monthly", 980, 0, "capitalized",
      { firstPaymentAmount: null },
    );
    expect(withNull).toEqual(legacy);
  });

  it("uses the stated first payment, then the regular payment", () => {
    const result = calculateAmortization(
      100000, 6, 5, 5, START, 0, [], 0, "monthly", 1980, 0, "capitalized",
      { firstPaymentAmount: 2450 },
    );
    const [first, second] = result.schedule;
    expect(first.payment).toBe(2450);
    expect(first.interest).toBeCloseTo(500, 6);
    expect(first.principal).toBeCloseTo(1950, 6);
    expect(first.balance).toBeCloseTo(98050, 6);
    expect(second.payment).toBe(1980);
    expect(result.monthlyPayment).toBe(1980);
    // Term = amortization: residual is cleared in the final row.
    const last = result.schedule.at(-1)!;
    expect(last.balance).toBeCloseTo(0, 6);
    expect(last.payment).not.toBe(1980);
  });

  it("applies to the first payment after a grace period", () => {
    const result = calculateAmortization(
      12000, 0, 2, 2, START, 0, [], 0, "monthly", null, 3, "none",
      { firstPaymentAmount: 1000 },
    );
    expect(result.schedule.slice(0, 3).every((r) => r.isGrace && r.payment === 0)).toBe(true);
    expect(result.schedule[3].payment).toBe(1000);
    expect(result.schedule[4].payment).not.toBe(1000);
  });

  it("is respected on the dated-event path", () => {
    const result = calculateAmortization(
      12000, 0, 1, 1, START, 0, [], 0, "monthly", 1000, 0, "none",
      {
        firstPaymentAmount: 2000,
        principalEvents: [{
          id: "e1",
          effectiveDate: new Date(2024, 5, 15),
          ordering: "after_scheduled_payment",
          sequence: 0,
          amount: 500,
          treatment: "keep_payment",
        }],
      },
    );
    const scheduled = result.schedule.filter((r) => r.rowType === "scheduled_payment");
    expect(scheduled[0].payment).toBe(2000);
    expect(scheduled[1].payment).toBe(1000);
  });

  it("flows into the fair-value measurement", () => {
    const base = {
      principal: 100000, contractualRate: 2, fvRate: 6,
      amortizationYears: 5, termYears: 5, startDate: START,
      paymentOverride: 1750,
    };
    const without = computeFvAdjustment(base);
    const withFirst = computeFvAdjustment(base, { firstPaymentAmount: 5000 });
    expect(withFirst).not.toBe(without);
  });
});
