import { describe, it, expect } from "vitest";
import { leaseAccountingProjection, validateLeaseEnding, unresolvedLeaseEnding } from "./lease-ending";
import { extractionSchema } from "./azure-extract";
import { calculateLeaseSchedule, type LeaseEndingTerms } from "@workspace/amortization";
import { isLoanOutstandingAt } from "./rollforward-eligibility";
import type { Loan } from "@workspace/db";

describe("lease ending API boundary", () => {
  it("projects reviewed accounting without rounding the implicit-rate evidence", () => {
    const ending = validateLeaseEnding({ version: 1, kind: "guaranteed_residual", amount: 8949.5, basis: "stated",
      source: "Return/sale shortfall guarantee", settlementMonth: 48, issues: [], status: "reviewed", implicitRate: 7.5306177 }, 48);
    const projection = leaseAccountingProjection({ isCapitalLease: true, fairValue: 89949.5, monthlyPayment: 2003.24,
      termMonths: 48, downPayment: 0, paymentTiming: "beginning", paymentFrequency: "monthly", startDate: "2026-03-30" }, ending);
    expect(projection.principal).toBe("89949.50");
    expect(projection.balloonPayment).toBe("8949.50");
    expect((projection.leaseEndingTerms as typeof ending).discountRate).toBe(7.5306177);
  });
  const reviewed: LeaseEndingTerms = { version: 1, kind: "guaranteed_residual", amount: 1000,
    basis: "stated", source: "Synthetic guarantee", settlementMonth: 48, status: "reviewed", issues: [], discountRate: 6 };
  const base = { isCapitalLease: true, fairValue: 50000, monthlyPayment: 1050, termMonths: 48,
    termYears: 4, amortizationYears: 4, startDate: "2026-01-01", paymentTiming: "end",
    paymentFrequency: "monthly", downPayment: 0, interestRate: 6 };
  it("rounds tax/service payments once before PV, then reconciles after reopening and roll-forward", () => {
    const projected = leaseAccountingProjection(base, { ...reviewed, taxTreatment: "recoverable", taxRate: 13, servicesMonthly: 100 });
    const saved = JSON.parse(JSON.stringify({ ...base, ...projected })) as Loan;
    expect(saved.monthlyPayment).toBe("829.20");
    const schedule = calculateLeaseSchedule({
      monthlyPayment: Number(saved.monthlyPayment), termMonths: 48, paymentAtBeginning: false,
      downPayment: 0, ending: saved.leaseEndingTerms as unknown as LeaseEndingTerms,
      annualRate: 6, startDate: new Date(2026, 0, 1), openingAmount: Number(saved.principal),
    });
    expect(schedule.schedule.at(-1)?.balance).toBeCloseTo(1000, 1);
    expect(isLoanOutstandingAt(saved, [], "2026-12-31")).toBe(true);
  });
  it("normalizes distinct first installments once and preserves their gross evidence", () => {
    const terms: LeaseEndingTerms = { ...reviewed, kind: "none", amount: 0, settlementMonth: 12, discountRate: 0,
      taxTreatment: "recoverable", taxRate: 13 };
    const input = { ...base, monthlyPayment: 1130, firstPaymentAmount: 2260, termMonths: 12, interestRate: 0 };
    const projected = leaseAccountingProjection(input, terms);
    expect(projected.principal).toBe("13000.00");
    expect(projected.monthlyPayment).toBe("1000.00");
    expect(projected.firstPaymentAmount).toBe("2000.00");
    const saved = JSON.parse(JSON.stringify({ ...input, ...projected }));
    expect(leaseAccountingProjection(saved, saved.leaseEndingTerms)).toEqual(projected);
    const withServices = leaseAccountingProjection(input, { ...terms, servicesMonthly: 100 });
    expect(withServices.principal).toBe("11800.00");
    expect(withServices.firstPaymentAmount).toBe("1900.00");
  });
  it.each(["mandatory_payment", "guaranteed_residual"] as const)("retains operating %s after rentals and settlement due dates", kind => {
    const operating = { ...base, isCapitalLease: false, leaseEndingTerms: { ...reviewed, kind, settlementMonth: 50 } } as unknown as Loan;
    expect(isLoanOutstandingAt(operating, [], "2030-02-28")).toBe(true);
    expect(isLoanOutstandingAt(operating, [], "2031-12-31")).toBe(true);
    expect(isLoanOutstandingAt({ ...operating, leaseEndingTerms: { ...reviewed, kind: "none", amount: 0 } }, [], "2031-12-31")).toBe(false);
  });
  it.each([
    { firstPaymentDate: "2026-01-15" },
    { activeEvents: [{ kind: "principal_prepayment", amount: 1000 }] },
    { initialEvents: [{ kind: "principal_prepayment", amount: 1000 }] },
    { rateType: "prime_linked" },
    { rateTimelineEvents: [{ kind: "rate_reset", resultingRate: 7 }] },
  ])("prevents unsupported reviewed calendars/timelines %j", patch => {
    expect(() => leaseAccountingProjection({ ...base, ...patch }, reviewed)).toThrow(/draft|event-aware/);
    if (!("initialEvents" in patch)) {
      expect(() => isLoanOutstandingAt({ ...base, ...patch, leaseEndingTerms: reviewed } as unknown as Loan,
        "activeEvents" in patch ? patch.activeEvents as never : "rateTimelineEvents" in patch ? patch.rateTimelineEvents as never : [], "2026-12-31")).toThrow(/draft|event-aware/);
    }
  });
  it("rejects marking unresolved or missing evidence reviewed", () => {
    expect(() => validateLeaseEnding({ ...unresolvedLeaseEnding("Missing appendix", 48), status: "reviewed" }, 48)).toThrow();
  });
  it("preserves draft evidence through JSON persistence", () => {
    const value = unresolvedLeaseEnding("Return clause contradicts purchase schedule", 48);
    const parsed = validateLeaseEnding(JSON.parse(JSON.stringify(value)), 48);
    expect(parsed.issues).toContain(value.issues[0]);
    expect(parsed.status).toBe("draft");
  });
  it.each(["mandatory_payment", "guaranteed_residual", "lessor_residual", "optional_purchase", "bargain_purchase", "none"])("retains extracted %s semantics without AI service", kind => {
    const leaseEndingTerms = { version: 1, kind, amount: kind === "none" ? 0 : 4000, basis: "stated", source: "Anonymized operative clause and schedule", settlementMonth: 36, status: "draft", issues: [] };
    const result = extractionSchema.parse({ classification: "lease", lease: { leaseEndingTerms }, loan: null });
    expect(result.lease?.leaseEndingTerms?.kind).toBe(kind);
  });
  it("rejects negative monetary API input", () => {
    expect(() => validateLeaseEnding({ ...unresolvedLeaseEnding("", 48), amount: -100 }, 48)).toThrow();
  });
});
