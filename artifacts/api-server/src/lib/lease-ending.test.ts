import { describe, it, expect } from "vitest";
import { validateLeaseClassification, leaseAccountingProjection, validateLeaseEnding, unresolvedLeaseEnding } from "./lease-ending";
import { extractionSchema } from "./azure-extract";
import { calculateLeaseSchedule, type LeaseEndingTerms } from "@workspace/amortization";
import { isLoanOutstandingAt } from "./rollforward-eligibility";
import type { Loan } from "@workspace/db";

describe("lease ending API boundary", () => {
  it("rejects purchase conflicts and unsupported operating approval at the server boundary", () => {
    const terms: LeaseEndingTerms = { version: 1, kind: "guaranteed_residual", amount: 8949.5,
      basis: "stated", source: "Synthetic sale shortfall guarantee", settlementMonth: 48,
      status: "reviewed", issues: [], implicitRate: 7.5306177 };
    const contract = { isCapitalLease: true, fairValue: 95000, monthlyPayment: 2003.24,
      termMonths: 48, paymentTiming: "beginning", transferOfOwnership: false,
      bargainPurchaseOption: false, leaseTermPct: 40 };
    expect(() => validateLeaseClassification(contract, terms)).not.toThrow();
    expect(() => validateLeaseClassification({ ...contract, isCapitalLease: false }, terms)).toThrow("conflicts");
    expect(() => validateLeaseClassification({ ...contract, bargainPurchaseOption: true }, terms)).toThrow("shortfall guarantee");
    expect(() => validateLeaseClassification(contract, { ...terms, kind: "bargain_purchase" })).toThrow("says No");
    expect(() => validateLeaseClassification({ ...contract, bargainPurchaseOption: true },
      { ...terms, kind: "bargain_purchase" })).not.toThrow();
    expect(() => validateLeaseClassification({ ...contract, isCapitalLease: false, fairValue: null, leaseTermPct: null },
      { ...terms, kind: "none", amount: 0 })).toThrow("unavailable");
  });
  it("projects reviewed accounting without rounding the implicit-rate evidence", () => {
    const ending = validateLeaseEnding({ version: 1, kind: "guaranteed_residual", amount: 8949.5, basis: "stated",
      source: "Return/sale shortfall guarantee", settlementMonth: 48, issues: [], status: "reviewed", implicitRate: 7.5306177 }, 48);
    const projection = leaseAccountingProjection({ isCapitalLease: true, fairValue: 89949.5, monthlyPayment: 2003.24,
      termMonths: 48, downPayment: 0, paymentTiming: "beginning", paymentFrequency: "monthly", startDate: "2026-03-30" }, ending);
    expect(projection.principal).toBe("89949.50");
    expect(projection.assetCost).toBe("89949.50");
    // Saving measurement must not replace assessment evidence with 100%.
    expect({ pvPctFairValue: "92.63", ...projection }.pvPctFairValue).toBe("92.63");
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
    const savedServices = JSON.parse(JSON.stringify({ ...input, ...withServices }));
    expect(leaseAccountingProjection(savedServices, savedServices.leaseEndingTerms)).toEqual(withServices);
  });
  it.each([0, 6])("reconciles first-installment streams at %s percent in advance and arrears with a fair-value cap", discountRate => {
    for (const paymentTiming of ["beginning", "end"]) {
      for (const fairValue of [11000, 20000]) {
        const ending = { ...reviewed, kind: "none" as const, amount: 0, settlementMonth: 12,
          discountRate, taxTreatment: "recoverable" as const, taxRate: 13, servicesMonthly: 100 };
        const input = { ...base, monthlyPayment: 1130, firstPaymentAmount: 2260,
          termMonths: 12, interestRate: discountRate, fairValue, paymentTiming };
        const projected = leaseAccountingProjection(input, ending);
        const saved = JSON.parse(JSON.stringify({ ...input, ...projected }));
        const schedule = calculateLeaseSchedule({ monthlyPayment: Number(saved.monthlyPayment),
          firstPaymentAmount: Number(saved.firstPaymentAmount), downPayment: 0, termMonths: 12,
          annualRate: discountRate, paymentAtBeginning: paymentTiming === "beginning",
          ending: saved.leaseEndingTerms, openingAmount: Number(saved.principal), startDate: new Date(2026, 0, 1) });
        expect(Number(saved.principal)).toBeLessThanOrEqual(fairValue);
        expect(schedule.schedule[0].payment).toBe(1900);
        expect(schedule.schedule.at(-1)?.balance).toBeCloseTo(0, 1);
        expect(leaseAccountingProjection(saved, saved.leaseEndingTerms)).toEqual(projected);
      }
    }
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
  it("retains a separately documented first rental on lease import", () => {
    const imported = extractionSchema.parse({ classification: "lease",
      lease: { monthlyPayment: 1130, firstPaymentAmount: 2260 }, loan: null });
    expect(imported.lease?.firstPaymentAmount).toBe(2260);
    expect(extractionSchema.parse({ classification: "lease", lease: {}, loan: null }).lease?.firstPaymentAmount).toBeNull();
  });
});
