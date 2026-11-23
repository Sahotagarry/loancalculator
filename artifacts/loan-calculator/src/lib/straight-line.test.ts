import { describe, it, expect } from "vitest";
import { calculateStraightLineLease, buildYearlyStraightLine, buildOperatingLeasePayments } from "./straight-line";

describe("calculateStraightLineLease", () => {
  const terms = { baseMonthlyRent: 900, termMonths: 12,
    startDate: "2026-07-01", fiscalYearEnd: "2026-12-31" };

  it("replaces rather than adds the distinct first rental and reconciles deferred rent", () => {
    const sl = calculateStraightLineLease({ ...terms, firstPaymentAmount: 1900 })!;
    expect(sl.totalLeasePayments).toBe(11800);
    expect(sl.monthlyStraightLineExpense).toBeCloseTo(983.333333, 6);
    expect(sl.schedule.map(p => p.actualPayment)).toEqual([1900, ...Array(11).fill(900)]);
    expect(sl.deferredRentAtYearEnd).toBeCloseTo(500, 6);
    expect(sl.schedule.at(-1)?.cumulativeDeferredRent).toBeCloseTo(0, 6);
    expect(buildYearlyStraightLine(sl.schedule)).toEqual([
      expect.objectContaining({ fiscalYear: 2026, actual: 6400, straightLine: expect.closeTo(5900), deferredRent: expect.closeTo(500) }),
      expect.objectContaining({ fiscalYear: 2027, actual: 5400, straightLine: expect.closeTo(5900), deferredRent: expect.closeTo(0) }),
    ]);
  });

  it.each([null, undefined])("keeps historical rental streams unchanged with first rental %s", firstPaymentAmount => {
    const legacy = { ...terms, termMonths: 30, freeRentMonths: 2, escalationRate: 5,
      rentSteps: [{ fromYear: 1, toYear: 1, monthlyRent: 900 }, { fromYear: 2, toYear: 2, monthlyRent: 1200 }],
      tenantImprovementAllowance: 1000, otherInducements: 500 };
    expect(calculateStraightLineLease({ ...legacy, firstPaymentAmount }))
      .toEqual(calculateStraightLineLease(legacy));
  });

  it("preserves free months, step precedence and the last-step extension", () => {
    const sl = calculateStraightLineLease({ ...terms, termMonths: 30, freeRentMonths: 2,
      firstPaymentAmount: 1900, escalationRate: 99,
      rentSteps: [{ fromYear: 2, toYear: 2, monthlyRent: 1200 }, { fromYear: 1, toYear: 1, monthlyRent: 900 }],
      tenantImprovementAllowance: 1000, otherInducements: 500 })!;
    expect(sl.schedule.map(p => p.actualPayment))
      .toEqual([0, 0, 1900, ...Array(9).fill(900), ...Array(18).fill(1200)]);
    expect(sl.totalLeasePayments).toBe(31600);
    expect(sl.monthlyStraightLineExpense).toBeCloseTo((31600 - 1500) / 30);
    expect(sl.schedule.at(-1)?.cumulativeDeferredRent).toBeCloseTo(1500);
  });

  it("replaces the first payable rental after a year of free rent without escalating it", () => {
    const payments = buildOperatingLeasePayments({ ...terms, termMonths: 15,
      freeRentMonths: 12, firstPaymentAmount: 1900, escalationRate: 10 });
    expect(payments.slice(0, 13)).toEqual([...Array(12).fill(0), 1900]);
    expect(payments[13]).toBeCloseTo(990);
    expect(payments[14]).toBeCloseTo(990);
    expect(buildOperatingLeasePayments({ ...terms, freeRentMonths: 12, firstPaymentAmount: 1900 }))
      .toEqual(Array(12).fill(0));
  });

  it("uses an explicit zero first rental instead of falling back to regular rent", () => {
    expect(buildOperatingLeasePayments({ ...terms, firstPaymentAmount: 0 }))
      .toEqual([0, ...Array(11).fill(900)]);
  });

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
