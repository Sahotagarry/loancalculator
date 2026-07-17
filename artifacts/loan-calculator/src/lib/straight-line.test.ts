import { describe, it, expect } from "vitest";
import { calculateStraightLineLease, buildYearlyStraightLine } from "./straight-line";

describe("calculateStraightLineLease", () => {
  it("returns null for degenerate inputs", () => {
    expect(
      calculateStraightLineLease({
        baseMonthlyRent: 0,
        termMonths: 12,
        startDate: "2024-01-01",
        fiscalYearEnd: "2024-12-31",
      }),
    ).toBeNull();
    expect(
      calculateStraightLineLease({
        baseMonthlyRent: 1000,
        termMonths: 0,
        startDate: "2024-01-01",
        fiscalYearEnd: "2024-12-31",
      }),
    ).toBeNull();
  });

  it("computes a flat lease with no deferred rent", () => {
    const result = calculateStraightLineLease({
      baseMonthlyRent: 1000,
      termMonths: 12,
      startDate: "2024-01-01",
      fiscalYearEnd: "2024-12-31",
    })!;

    expect(result.totalLeasePayments).toBeCloseTo(12000, 6);
    expect(result.totalConsideration).toBeCloseTo(12000, 6);
    expect(result.monthlyStraightLineExpense).toBeCloseTo(1000, 6);
    expect(result.deferredRentAtYearEnd).toBeCloseTo(0, 6);
    expect(result.schedule).toHaveLength(12);
  });

  it("spreads free rent evenly and unwinds deferred rent to zero by term end", () => {
    const result = calculateStraightLineLease({
      baseMonthlyRent: 1000,
      termMonths: 12,
      freeRentMonths: 2,
      startDate: "2024-01-01",
      fiscalYearEnd: "2024-12-31",
    })!;

    // Only 10 months are actually paid.
    expect(result.totalLeasePayments).toBeCloseTo(10000, 6);
    expect(result.monthlyStraightLineExpense).toBeCloseTo(10000 / 12, 6);
    // First (free) month recognizes expense but pays nothing.
    expect(result.schedule[0].actualPayment).toBeCloseTo(0, 6);
    // Deferred rent nets back to zero over the full term.
    expect(result.schedule[11].cumulativeDeferredRent).toBeCloseTo(0, 6);
  });

  it("applies annual escalation to the payment schedule", () => {
    const result = calculateStraightLineLease({
      baseMonthlyRent: 1000,
      termMonths: 24,
      escalationRate: 10,
      startDate: "2024-01-01",
      fiscalYearEnd: "2024-12-31",
    })!;

    // Year 1 at 1000/mo, year 2 at 1100/mo.
    expect(result.totalLeasePayments).toBeCloseTo(25200, 6);
    expect(result.monthlyStraightLineExpense).toBeCloseTo(1050, 6);
    // At the first year end, expense (1050) exceeds cash paid (1000) for 12 months.
    expect(result.deferredRentAtYearEnd).toBeCloseTo(-600, 6);
  });

  it("nets tenant inducements out of the straight-line expense", () => {
    const result = calculateStraightLineLease({
      baseMonthlyRent: 1000,
      termMonths: 12,
      tenantImprovementAllowance: 6000,
      startDate: "2024-01-01",
      fiscalYearEnd: "2024-12-31",
    })!;

    expect(result.totalInducements).toBeCloseTo(6000, 6);
    expect(result.totalConsideration).toBeCloseTo(6000, 6);
    expect(result.monthlyStraightLineExpense).toBeCloseTo(500, 6);
  });
});

describe("buildYearlyStraightLine", () => {
  it("aggregates monthly periods into fiscal-year totals", () => {
    const result = calculateStraightLineLease({
      baseMonthlyRent: 1000,
      termMonths: 24,
      escalationRate: 10,
      startDate: "2024-01-01",
      fiscalYearEnd: "2024-12-31",
    })!;

    const yearly = buildYearlyStraightLine(result.schedule);
    expect(yearly).toHaveLength(2);

    const fy2024 = yearly.find((y) => y.fiscalYear === 2024)!;
    const fy2025 = yearly.find((y) => y.fiscalYear === 2025)!;
    expect(fy2024.actual).toBeCloseTo(12000, 6);
    expect(fy2025.actual).toBeCloseTo(13200, 6);
    expect(fy2024.straightLine).toBeCloseTo(12600, 6);
    expect(fy2025.straightLine).toBeCloseTo(12600, 6);
  });
});
