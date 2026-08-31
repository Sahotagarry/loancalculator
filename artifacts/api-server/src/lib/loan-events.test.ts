import { describe, expect, it } from "vitest";
import {
  EventTimelineError,
  fingerprintLoanEvents,
  normalizeLoanEvents,
  type ProposedLoanEvent,
} from "./loan-events";

const event = (overrides: Partial<ProposedLoanEvent> = {}): ProposedLoanEvent => ({
  kind: "principal_prepayment",
  effectiveDate: "2025-06-30",
  ordering: "after_scheduled_payment",
  sequence: 1,
  amount: 25000,
  treatment: "keep_payment",
  classification: "ordinary",
  source: "signed amendment",
  reason: "Contractual lump sum",
  authoredAt: "2025-01-15T12:00:00.000Z",
  ...overrides,
});

describe("loan event timeline", () => {
  it("fingerprints sourced rate evidence", () => {
    const reset = {
      kind: "rate_reset" as const,
      effectiveDate: "2025-01-02",
      observationDate: "2024-12-31",
      publishedDate: null,
      fetchedAt: "2025-01-02T12:00:00Z",
      ordering: "before_scheduled_payment" as const,
      sequence: 1,
      benchmarkRate: 5.25,
      spread: 1.5,
      resultingRate: 6.75,
      benchmark: "Bank of Canada chartered bank prime",
      sourceUrl: "https://www.bankofcanada.ca/valet/observations/V80691311/json",
      sourceSeries: "V80691311",
      rateOrigin: "automatic" as const,
      treatment: "keep_payment" as const,
      classification: "ordinary" as const,
      source: "Bank of Canada Valet API",
      reason: "Contractual benchmark reset",
      authoredAt: "2025-01-02T12:00:00Z",
    };
    expect(fingerprintLoanEvents("revision-1", [reset])).not.toBe(
      fingerprintLoanEvents("revision-1", [{ ...reset, spread: 1.55, resultingRate: 6.8 }]),
    );
  });

  it("fingerprints canonical sorted events", () => {
    const first = event();
    const second = event({
      effectiveDate: "2025-05-31",
      sequence: 2,
      amount: 5000,
    });
    expect(fingerprintLoanEvents("revision-1", [first, second])).toBe(
      fingerprintLoanEvents("revision-1", [second, first]),
    );
    expect(fingerprintLoanEvents("revision-2", [first, second])).not.toBe(
      fingerprintLoanEvents("revision-1", [first, second]),
    );
  });

  it("rejects invalid and duplicate events", () => {
    expect(() => normalizeLoanEvents([event({ sequence: 0 })])).toThrow(
      "sequence must be a positive integer",
    );
    expect(() =>
      normalizeLoanEvents([event(), event({ sequence: 2 })]),
    ).toThrow("duplicate principal prepayment event");
  });

  it("routes agreement changes to the modification workflow", () => {
    try {
      normalizeLoanEvents([event({ classification: "agreement_change" })]);
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(EventTimelineError);
      expect((error as EventTimelineError).status).toBe(409);
      expect((error as Error).message).toContain("renewal/modification");
    }
  });
});