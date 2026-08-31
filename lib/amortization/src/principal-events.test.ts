import { describe, expect, it } from "vitest";
import {
  calculateAmortization,
  calculateFairValueSchedule,
  type PrincipalPaymentEvent,
} from "./index";

const START = new Date(2024, 0, 1);
const event = (
  overrides: Partial<PrincipalPaymentEvent> = {},
): PrincipalPaymentEvent => ({
  id: "event-1",
  effectiveDate: new Date(2024, 2, 1),
  ordering: "after_scheduled_payment",
  sequence: 0,
  amount: 2400,
  treatment: "keep_payment",
  ...overrides,
});

describe("principal payment events", () => {
  it("keeps the regular payment and permits an early payoff", () => {
    const result = calculateAmortization(
      12000, 0, 1, 1, START, 0, [], 0, "monthly", null, 0, "none",
      { principalEvents: [event()] },
    );
    const eventRow = result.schedule.find((row) => row.rowType === "principal_event")!;
    expect(eventRow.payment).toBe(2400);
    expect(eventRow.interest).toBe(0);
    expect(result.schedule.at(-1)!.date < new Date(2024, 11, 1)).toBe(true);
  });

  it("recasts only future payments when maturity is retained", () => {
    const result = calculateAmortization(
      12000, 0, 1, 1, START, 0, [], 0, "monthly", null, 0, "none",
      { principalEvents: [event({ treatment: "keep_maturity" })] },
    );
    const after = result.schedule.find(
      (row) => row.rowType === "scheduled_payment" && row.date > new Date(2024, 2, 1),
    )!;
    expect(after.payment).toBeCloseTo(6600 / 9, 8);
    expect(result.schedule.at(-1)!.date).toEqual(new Date(2024, 11, 1));
    expect(result.schedule.at(-1)!.balance).toBeCloseTo(0, 8);
  });

  it("orders same-day events around the scheduled payment and by sequence", () => {
    const result = calculateAmortization(
      12000, 0, 1, 1, START, 0, [], 0, "monthly", null, 0, "none", {
        principalEvents: [
          event({ id: "after", amount: 100, sequence: 0 }),
          event({ id: "before-2", amount: 100, ordering: "before_scheduled_payment", sequence: 2 }),
          event({ id: "before-1", amount: 100, ordering: "before_scheduled_payment", sequence: 1 }),
        ],
      },
    );
    const onDate = result.schedule.filter((row) => row.date.getTime() === new Date(2024, 2, 1).getTime());
    expect(onDate.map((row) => row.eventId ?? "scheduled"))
      .toEqual(["before-1", "before-2", "scheduled", "after"]);
  });

  it("retains between-date interest and rejects principal overpayments", () => {
    const result = calculateAmortization(
      12000, 12, 1, 1, START, 0, [], 0, "monthly", null, 0, "none", {
        principalEvents: [event({
          effectiveDate: new Date(2024, 0, 16),
          amount: 1000,
        })],
      },
    );
    const eventRow = result.schedule.find((row) => row.rowType === "principal_event");
    const nextPayment = result.schedule.find(
      (row) => row.rowType === "scheduled_payment" && row.date > new Date(2024, 0, 16),
    );
    expect(eventRow?.accruedInterest).toBeGreaterThan(0);
    expect(nextPayment?.interest).toBeGreaterThan(eventRow!.accruedInterest!);

    const payoff = calculateAmortization(
      12000, 12, 1, 1, START, 0, [], 0, "monthly", null, 0, "none", {
        principalEvents: [event({
          effectiveDate: START,
          ordering: "before_scheduled_payment",
          amount: 12000,
        })],
      },
    );
    const settlement = payoff.schedule.find(
      (row) => row.rowType === "accrued_interest_settlement",
    );
    expect(settlement?.principal).toBe(0);
    expect(settlement?.interest).toBeGreaterThan(0);

    expect(() => calculateAmortization(
      1000, 0, 1, 1, START, 0, [], 0, "monthly", null, 0, "none",
      { principalEvents: [event({ amount: 1001 })] },
    )).toThrow(/exceeds the outstanding principal/);
  });

  it("discounts event cash flows at fractional contractual times and returns evidence", () => {
    const evidence = { eventSetVersion: "v2", termRevision: "rev-4" };
    const contractual = calculateAmortization(
      12000, 2, 1, 1, START, 0, [], 0, "monthly", null, 0, "none", {
        evidenceMetadata: evidence,
        principalEvents: [event({ effectiveDate: new Date(2024, 1, 15), amount: 1000 })],
      },
    );
    const fv = calculateFairValueSchedule(
      contractual.schedule, 7, "monthly", { evidenceMetadata: evidence },
    );
    expect(contractual.evidenceMetadata).toBe(evidence);
    expect(fv.evidenceMetadata).toBe(evidence);
    expect(fv.schedule.find((row) => row.eventId === "event-1")?.interest).toBeGreaterThan(0);
  });

  it("settles accrued interest after exact payoff during capitalizing grace without reviving principal", () => {
    const result = calculateAmortization(
      1000, 12, 1, 1, START, 0, [], 0, "monthly", null, 2, "capitalized", {
        principalEvents: [event({
          effectiveDate: START,
          ordering: "before_scheduled_payment",
          amount: 1000,
        })],
      },
    );
    expect(result.schedule.map((row) => row.rowType))
      .toEqual(["principal_event", "accrued_interest_settlement"]);
    expect(result.schedule[1].interest).toBeCloseTo(10, 8);
    expect(result.schedule[1].principal).toBe(0);
    expect(result.schedule.every((row) => row.balance >= 0)).toBe(true);
    expect(result.schedule.at(-1)!.balance).toBe(0);
  });

  it("uses commencement-based fractions for events before an explicit first due date", () => {
    for (const paymentTiming of ["end", "beginning"] as const) {
      const contractual = calculateAmortization(
        12000, 0, 1, 1, START, 0, [], 0, "monthly", null, 0, "none", {
          paymentTiming,
          firstPaymentDate: new Date(2024, 3, 1),
          principalEvents: [event({ effectiveDate: new Date(2024, 1, 1), amount: 1000 })],
        },
      );
      const dated = calculateFairValueSchedule(
        contractual.schedule, 12, "monthly", { paymentTiming, commencementDate: START },
      );
      const fallback = calculateFairValueSchedule(
        contractual.schedule, 12, "monthly", { paymentTiming },
      );
      // Feb 1 is only one-third of the Jan 1–Apr 1 contractual interval, so
      // its receipt has a higher PV than the legacy first-due placement.
      expect(dated.fairValue).toBeGreaterThan(fallback.fairValue);
    }
  });
});