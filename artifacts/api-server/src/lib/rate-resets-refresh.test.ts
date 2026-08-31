import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [] as Array<Record<string, any>>,
  findings: [] as Array<Record<string, any>>,
  loan: {} as Record<string, any>,
  run: {} as Record<string, any>,
}));

const tables = vi.hoisted(() => ({
  loansTable: { id: "loan.id", rateType: "loan.rateType", deletedAt: "loan.deletedAt" },
  loanEventsTable: {
    id: "event.id", loanId: "event.loanId", setId: "event.setId", sequence: "event.sequence",
    kind: "event.kind", effectiveDate: "event.effectiveDate", rateOrigin: "event.rateOrigin",
  },
  rateResetFindingsTable: {
    loanId: "finding.loanId", observationDate: "finding.observationDate",
    contractualEffectiveDate: "finding.contractualEffectiveDate", status: "finding.status",
  },
  rateRefreshRunsTable: { id: "run.id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (field: string, value: unknown) => ({ op: "eq", field, value }),
  and: (...items: unknown[]) => ({ op: "and", items }),
  or: (...items: unknown[]) => ({ op: "or", items }),
  asc: (field: string) => field,
  isNull: (field: string) => ({ op: "null", field }),
}));

function valuesFor(table: unknown) {
  if (table === tables.loansTable) return [state.loan];
  if (table === tables.loanEventsTable) return state.events;
  return [];
}

function query(data: Array<Record<string, any>>) {
  return {
    where: () => ({
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(data).then(resolve),
      limit: () => Promise.resolve(data.slice(0, 1)),
      orderBy: () => Promise.resolve(data),
    }),
  };
}

const db = vi.hoisted(() => ({
  select: () => ({ from: (table: unknown) => query(valuesFor(table)) }),
  insert: (table: unknown) => ({
    values: (value: Record<string, any>) => ({
      returning: async () => {
        if (table === tables.rateRefreshRunsTable) {
          state.run = { id: "run-1", ...value };
          return [state.run];
        }
        state.findings.push(value);
        return [value];
      },
      onConflictDoNothing: async () => undefined,
    }),
  }),
  update: (table: unknown) => ({
    set: (value: Record<string, any>) => ({
      where: () => {
        if (table === tables.rateResetFindingsTable) {
          for (const finding of state.findings) {
            if (finding.loanId === state.loan.id && finding.contractualEffectiveDate === "2026-03-01") {
              Object.assign(finding, value);
            }
          }
        } else if (table === tables.rateRefreshRunsTable) {
          Object.assign(state.run, value);
        }
        return {
          then: (resolve: (result: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
          returning: async () => [state.run],
        };
      },
    }),
  }),
  transaction: async (callback: (tx: any) => unknown) => callback(db),
}));

vi.mock("@workspace/db", () => ({ db, ...tables }));
vi.mock("./prime-rates", () => ({
  fetchPrimeObservation: async (date: string) => ({
    observationDate: date, publishedDate: null, fetchedAt: new Date("2026-03-02T00:00:00Z"),
    rate: 4.95, sourceUrl: "https://www.bankofcanada.ca/valet/observations/V80691311/json",
    sourceSeries: "V80691311",
  }),
  fetchPrimeObservationRange: vi.fn(),
}));
vi.mock("./loan-events", () => ({
  EventTimelineError: class extends Error {
    constructor(message: string, readonly status = 400) { super(message); }
  },
  proposedFromStored: (event: Record<string, any>) => event,
  appendLoanEventSet: async (_tx: unknown, loanId: string, input: { events: Array<Record<string, any>> }) => {
    state.events = input.events.map((event, index) => ({
      id: `event-${index + 1}`, loanId, setId: "set-1", ...event,
    }));
    return { events: state.events };
  },
}));

import { refreshDueRateResets, restoreSourcedRate } from "./rate-resets";

describe("periodic refresh idempotency by contractual effective date", () => {
  beforeEach(() => {
    state.events = [];
    state.findings = [
      { loanId: "loan-1", observationDate: "2026-01-30", contractualEffectiveDate: "2026-03-01", status: "unresolved" },
      { loanId: "loan-1", observationDate: "2026-02-28", contractualEffectiveDate: "2026-03-01", status: "unresolved" },
    ];
    state.loan = {
      id: "loan-1", rateType: "prime_linked", rateBenchmark: "boc_v80691311",
      benchmarkEquivalentToContractualPrime: true, rateSpread: "1.0000",
      rateResetFrequency: "monthly", rateEffectiveConvention: "next_payment_date",
      ratePaymentTreatment: "keep_payment", startDate: "2026-01-30",
      firstPaymentDate: "2026-03-01", principal: "100000", downPayment: "0",
      interestRate: "6", amortizationYears: 10, termYears: 2, termMonths: null,
      ioMonths: 0, specificIoMonths: "", balloonPayment: "0", paymentFrequency: "monthly",
      paymentOverride: null, graceMonths: 0, graceInterestTreatment: "capitalized",
      paymentTiming: "end", graceTermMode: "included", currentRevisionId: "revision-1",
      activeEventSetId: null, activeEventSetVersion: null, deletedAt: null,
    };
  });

  it("applies once, reconciles converged findings, and applies zero on rerun", async () => {
    const first = await refreshDueRateResets("2026-02-28");
    expect(first.applied).toBe(1);
    expect(state.events).toHaveLength(1);
    expect(state.events[0].effectiveDate).toBe("2026-03-01");
    expect(state.findings.every((finding) => finding.status === "resolved")).toBe(true);

    const second = await refreshDueRateResets("2026-02-28");
    expect(second.applied).toBe(0);
    expect(second.unresolved).toBe(0);
    expect(state.events).toHaveLength(1);
    expect(state.findings.every((finding) => finding.status === "resolved")).toBe(true);
  });

  it("restores a sourced past observation without forecasting", async () => {
    const result = await restoreSourcedRate(
      "loan-1",
      "2026-02-28",
      "reviewer",
      new Date("2026-03-02T00:00:00Z"),
    );
    expect(result.applied).toBe(true);
    expect(state.events).toHaveLength(1);
    expect(state.events[0].rateOrigin).toBe("restore");
    expect(state.events[0].observationDate).toBe("2026-02-28");
  });
});