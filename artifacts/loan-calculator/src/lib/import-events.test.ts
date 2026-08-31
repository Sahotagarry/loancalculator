import { describe, expect, it } from "vitest";
import { canPersistImportedEvents, importedEventsToInputs, normalizeEventSequences, type ConfirmedImportEvent } from "./import-events";
import { buildFileSummary, calculateBookedSchedule, toPrincipalPaymentEvents, toRateResetEvents } from "./aspe-utils";

const event: ConfirmedImportEvent = {
  kind: "principal_prepayment", effectiveDate: "2025-06-15", ordering: "after_scheduled_payment",
  amount: 1000, treatment: "keep_payment", classification: "ordinary", source: "Signed PDF",
  reason: "Contractual lump sum", requiresConfirmation: true,
};

describe("imported principal payment events", () => {
  it("requires acknowledgement and ordinary classification before persistence", () => {
    expect(canPersistImportedEvents([event], false)).toBe(false);
    expect(canPersistImportedEvents([{ ...event, classification: "agreement_change" }], true)).toBe(false);
    expect(canPersistImportedEvents([event], true)).toBe(true);
  });

  it("maps API events and carries event-set evidence into booked schedules", () => {
    const inputs = importedEventsToInputs([event]);
    expect(toPrincipalPaymentEvents({ activeEvents: [{ ...inputs[0], id: "e1" }] })[0].amount).toBe(1000);
    const booked = calculateBookedSchedule({
      principal: 10000, interestRate: 5, amortizationYears: 2, termYears: 2, startDate: "2025-01-15",
      activeEvents: [{ ...inputs[0], id: "e1" }], currentRevisionId: "rev", activeEventSetId: "set",
      activeEventSetVersion: 1, activeEventSetHash: "fingerprint",
    });
    expect(booked.schedule.some((row) => row.rowType === "principal_event")).toBe(true);
    expect(booked.evidenceMetadata?.activeEventSetId).toBe("set");
  });

  it("normalizes drafts to deterministic positive one-based sequences", () => {
    const normalized = normalizeEventSequences([
      { ...importedEventsToInputs([event])[0], effectiveDate: "2025-07-01", ordering: "after_scheduled_payment", sequence: 0 },
      { ...importedEventsToInputs([event])[0], effectiveDate: "2025-06-01", ordering: "after_scheduled_payment", sequence: 99 },
      { ...importedEventsToInputs([event])[0], effectiveDate: "2025-06-01", ordering: "before_scheduled_payment", sequence: 0 },
    ]);
    expect(normalized.map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(normalized[0].ordering).toBe("before_scheduled_payment");
  });

  it("uses active rate resets in production booked and file-summary schedules without changing fixed loans", () => {
    const base = {
      id: "loan", name: "Variable", principal: 12000, interestRate: 4, amortizationYears: 2, termYears: 2,
      startDate: "2025-01-01", paymentFrequency: "monthly" as const, isCapitalLease: false,
    };
    const activeRateEvents = [{
      kind: "rate_reset", id: "rate-1", effectiveDate: "2025-07-01", ordering: "before_scheduled_payment",
      sequence: 1, benchmarkRate: 8, spread: 0, resultingRate: 8, source: "BoC", sourceSeries: "V80691311",
      observationDate: "2025-07-01", treatment: "keep_maturity",
    }];
    expect(toRateResetEvents({ activeRateEvents, ratePaymentTreatment: "keep_maturity" })).toHaveLength(1);
    const fixed = calculateBookedSchedule(base);
    const variable = calculateBookedSchedule({ ...base, rateType: "prime_linked", ratePaymentTreatment: "keep_maturity", activeRateEvents });
    expect(variable.totalInterest).toBeGreaterThan(fixed.totalInterest);
    expect(variable.monthlyPayment).not.toBe(fixed.monthlyPayment);
    const summary = buildFileSummary([{ ...base, rateType: "prime_linked", ratePaymentTreatment: "keep_maturity", activeRateEvents }], "2025-12-31");
    expect(summary.totalInterestExpense).toBeGreaterThan(0);
    expect(calculateBookedSchedule({ ...base, rateType: "fixed", activeRateEvents: [] }).totalInterest).toBe(fixed.totalInterest);
  });
});