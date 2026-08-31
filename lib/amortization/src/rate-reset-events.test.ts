import { describe, expect, it } from "vitest";
import {
  calculateAmortization,
  computeFvAdjustment,
  type RateResetEvent,
} from "./index";

const START = new Date(2024, 0, 1);
const reset = (overrides: Partial<RateResetEvent> = {}): RateResetEvent => ({
  id: "reset-1",
  effectiveDate: new Date(2024, 3, 1),
  ordering: "before_scheduled_payment",
  sequence: 0,
  benchmarkRate: 5,
  spread: 1,
  resultingContractualRate: 6,
  sourceEvidence: {
    source: "Bank of Canada V80691311",
    observationDate: new Date(2024, 2, 27),
  },
  treatment: "keep_payment",
  ...overrides,
});

const schedule = (
  rateResetEvents: readonly RateResetEvent[],
  extra: Parameters<typeof calculateAmortization>[12] = {},
) => calculateAmortization(
  12000, 12, 1, 1, START, 0, [], 0, "monthly", null, 0, "none",
  { ...extra, rateResetEvents },
);

describe("contractual rate reset events", () => {
  it("applies an immediate reset and keeps the installment when requested", () => {
    const fixed = schedule([]);
    const changed = schedule([reset({ effectiveDate: START, resultingContractualRate: 6 })]);
    expect(changed.monthlyPayment).toBeCloseTo(fixed.monthlyPayment, 10);
    expect(changed.schedule[0].contractualAnnualRate).toBe(6);
    expect(changed.totalInterest).toBeLessThan(fixed.totalInterest);
  });

  it("segments interest fractionally on a between-due-date reset", () => {
    const result = schedule([reset({
      effectiveDate: new Date(2024, 0, 16),
      resultingContractualRate: 6,
    })]);
    const february = result.schedule.find(
      (row) => row.rowType === "scheduled_payment" && row.date.getTime() === new Date(2024, 1, 1).getTime(),
    )!;
    expect(february.rateSegments).toHaveLength(2);
    expect(february.rateSegments?.map((part) => part.annualContractualRate)).toEqual([12, 6]);
    const opening = february.openingBalance!;
    expect(february.interest).toBeCloseTo(
      opening * 0.01 * (15 / 31) + opening * 0.005 * (16 / 31),
      8,
    );
  });

  it("prospectively recasts future installments to retain maturity", () => {
    const fixed = schedule([]);
    const result = schedule([reset({
      treatment: "keep_maturity",
      resultingContractualRate: 6,
    })]);
    const before = result.schedule.filter((row) => row.date < new Date(2024, 3, 1));
    const fixedBefore = fixed.schedule.filter((row) => row.date < new Date(2024, 3, 1));
    expect(before.map((row) => row.payment)).toEqual(fixedBefore.map((row) => row.payment));
    expect(result.schedule.find((row) => row.date > new Date(2024, 3, 1))?.payment)
      .toBeLessThan(fixed.monthlyPayment);
    expect(result.schedule.at(-1)?.date).toEqual(fixed.schedule.at(-1)?.date);
    expect(result.schedule.at(-1)?.balance).toBeCloseTo(0, 6);
  });

  it("retains maturity when a recasting reset occurs between due dates", () => {
    const result = schedule([reset({
      effectiveDate: new Date(2024, 0, 16),
      treatment: "keep_maturity",
      resultingContractualRate: 6,
    })]);
    expect(result.schedule.at(-1)?.date).toEqual(new Date(2024, 11, 1));
    expect(result.schedule.at(-1)?.balance).toBeCloseTo(0, 6);
  });

  it("uses the shared phase and sequence ordering with principal events", () => {
    const result = schedule([
      reset({ sequence: 2, treatment: "keep_maturity", resultingContractualRate: 6 }),
    ], {
      principalEvents: [{
        id: "principal-1",
        effectiveDate: new Date(2024, 3, 1),
        ordering: "before_scheduled_payment",
        sequence: 1,
        amount: 1000,
        treatment: "keep_maturity",
      }],
    });
    const rows = result.schedule.filter((row) => row.date.getTime() === new Date(2024, 3, 1).getTime());
    expect(rows.map((row) => row.eventId ?? "scheduled")).toEqual(["principal-1", "scheduled"]);
    expect(rows.at(-1)?.contractualAnnualRate).toBe(6);
  });

  it("does not rewrite historical rows across multiple periodic resets", () => {
    const first = schedule([reset()]);
    const second = schedule([
      reset(),
      reset({
        id: "reset-2",
        effectiveDate: new Date(2024, 7, 1),
        sequence: 0,
        benchmarkRate: 4,
        resultingContractualRate: 5,
      }),
    ]);
    expect(second.schedule.filter((row) => row.date < new Date(2024, 7, 1)))
      .toEqual(first.schedule.filter((row) => row.date < new Date(2024, 7, 1)));
  });

  it("uses reset rates during interest-only and capitalizing grace periods", () => {
    const io = calculateAmortization(
      12000, 12, 1, 1, START, 2, [], 0, "monthly", null, 0, "none",
      { rateResetEvents: [reset({ effectiveDate: new Date(2024, 0, 16), resultingContractualRate: 6 })] },
    );
    expect(io.schedule[1].isInterestOnly).toBe(true);
    expect(io.schedule[1].rateSegments).toHaveLength(2);

    const grace = calculateAmortization(
      12000, 12, 1, 1, START, 0, [], 0, "monthly", null, 2, "capitalized",
      { rateResetEvents: [reset({ effectiveDate: new Date(2024, 0, 16), resultingContractualRate: 6 })] },
    );
    expect(grace.schedule[1].isGrace).toBe(true);
    expect(grace.schedule[1].interest).toBeLessThan(121);
    expect(grace.schedule[1].interest).toBeGreaterThan(60);
  });

  it("keeps FV expected assumptions separate from realized resets", () => {
    const realized = reset({ effectiveDate: START, resultingContractualRate: 20 });
    const withoutRealized = computeFvAdjustment({
      principal: 12000,
      contractualRate: 5,
      fvRate: 8,
      amortizationYears: 1,
      termYears: 1,
      startDate: START,
    });
    const ignoredRealized = computeFvAdjustment({
      principal: 12000,
      contractualRate: 5,
      fvRate: 8,
      amortizationYears: 1,
      termYears: 1,
      startDate: START,
    }, { rateResetEvents: [realized] });
    const frozenExpected = computeFvAdjustment({
      principal: 12000,
      contractualRate: 5,
      fvRate: 8,
      amortizationYears: 1,
      termYears: 1,
      startDate: START,
    }, { fvExpectedRateResetEvents: [realized] });
    expect(ignoredRealized).toBe(withoutRealized);
    expect(frozenExpected).not.toBe(withoutRealized);
  });
});