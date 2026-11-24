import { describe, expect, it } from "vitest";
import { calculateAmortization, calculateLeaseSchedule, inferLeaseCommencement, leaseImplicitRate, leasePresentValue, lesseeEndingAmount, normalizeLeaseEnding, type LeaseEndingTerms } from "./index";

const terms = (patch: Partial<LeaseEndingTerms> = {}): LeaseEndingTerms => ({
  version: 1, kind: "guaranteed_residual", amount: 8949.50, basis: "stated",
  source: "Return and sale: lessee pays shortfall against agreed residual; surplus returned.",
  settlementMonth: 48, issues: [], status: "reviewed", taxTreatment: "excluded", ...patch,
});
const truck = { monthlyPayment: 2003.24, termMonths: 48, paymentAtBeginning: true, downPayment: 0, ending: terms() };

describe("explicit lease ending contract", () => {
  it("computes reserves independently of legal treatment", () => {
    const reserve = normalizeLeaseEnding(terms({ basis: "reserve", amount: null, baseAmount: 89949.5,
      reserves: [1266, 1519, 1856, 2109].map((monthlyAmount, i) => ({ fromMonth: i * 12 + 1, toMonth: (i + 1) * 12, monthlyAmount })) }), 48);
    expect(reserve.amount).toBe(8949.5);
    expect(reserve.explanation).toContain("81000");
    const unlinked = normalizeLeaseEnding({ ...reserve, kind: "unresolved" }, 48);
    expect(unlinked.amount).toBe(8949.5);
    expect(unlinked.status).toBe("draft");
    expect(() => lesseeEndingAmount(unlinked)).toThrow();
  });
  it("reconciles advance truck cash flows and separate settlement timing", () => {
    const rate = leaseImplicitRate(truck, 89949.5)!;
    expect(rate).toBeCloseTo(7.5306177, 6);
    expect(rate / 12).toBeCloseTo(0.6275515, 6);
    expect(leasePresentValue(truck, rate)).toBeCloseTo(89949.5, 6);
    const schedule = calculateLeaseSchedule({ ...truck, annualRate: rate, startDate: new Date(2026, 2, 30) }).schedule;
    expect(schedule[0].interest).toBe(0);
    expect(schedule[0].balance).toBeCloseTo(87946.26, 6);
    expect(schedule[47].date).toEqual(new Date(2030, 1, 28));
    expect(schedule[48].date).toEqual(new Date(2030, 2, 30));
    expect(schedule[48].payment).toBe(0);
    expect(schedule[48].balance).toBeCloseTo(8949.5, 6);
    expect(schedule.reduce((sum, row) => sum + row.principal, 0) + schedule[48].balance).toBeCloseTo(89949.5, 6);
  });
  it.each(["mandatory_payment", "guaranteed_residual", "bargain_purchase"] as const)("includes %s", kind => {
    expect(lesseeEndingAmount(terms({ kind }))).toBe(8949.5);
  });
  it.each(["optional_purchase", "lessor_residual", "none"] as const)("does not create liability for %s", kind => {
    expect(lesseeEndingAmount(terms({ kind, amount: kind === "none" ? 0 : 8949.5 }))).toBe(0);
  });
  it("uses lessor residual only to estimate implicit rate", () => {
    const input = { ...truck, ending: terms({ kind: "lessor_residual" }) };
    expect(leaseImplicitRate(input, 89949.5)).toBeCloseTo(7.5306177, 6);
    expect(leasePresentValue(input, 7.5306177)).toBeLessThan(89949.5);
  });
  it("calculates supported percentages", () => {
    expect(normalizeLeaseEnding(terms({ kind: "mandatory_payment", basis: "percentage", baseAmount: 60000, percentage: 15, amount: null }), 48).amount).toBe(9000);
  });
  it("calculates documented additive formulas without evaluating arbitrary expressions", () => {
    expect(normalizeLeaseEnding(terms({ basis: "sum", sumAmounts: [1000, 250, 12.5], amount: null }), 48).amount).toBe(1262.5);
  });
  it.each([
    { basis: "unsupported" as const, amount: null },
    { basis: "percentage" as const, baseAmount: -10, percentage: 10 },
    { basis: "reserve" as const, baseAmount: 10000, reserves: [{ fromMonth: 1, toMonth: 24, monthlyAmount: 10 }] },
    { amount: -1 }, { amount: Number.NaN }, { amount: Infinity },
    { issues: ["Missing purchase appendix"] }, { issues: ["Conflicting return and sale clauses"] },
    { taxTreatment: "unresolved" as const },
  ])("fails closed for unresolved evidence %j", patch => {
    expect(normalizeLeaseEnding(terms(patch), 48).status).toBe("draft");
  });
  it("retains inferred date derivation and requires confirmation", () => {
    const commencement = inferLeaseCommencement("2030-03-30", 48)!;
    expect(commencement.date).toBe("2026-03-30");
    expect(commencement.confirmed).toBe(false);
    expect(normalizeLeaseEnding(terms({ commencement }), 48).status).toBe("draft");
  });
  it("handles zero rates, down payments and distinct first installments without double counting", () => {
    const a = { ...truck, monthlyPayment: 100, downPayment: 200, firstPaymentAmount: 150, termMonths: 12,
      ending: terms({ kind: "none", amount: 0, settlementMonth: 12, refundableDeposit: 500 }) };
    expect(leasePresentValue(a, 0)).toBe(1450);
    const s = calculateLeaseSchedule({ ...a, annualRate: 0, startDate: new Date(2026, 0, 1) });
    expect(s.schedule[0].balance).toBe(1100);
    expect(s.schedule.at(-1)?.balance).toBe(0);
  });
  it("discounts arrears one period later", () => {
    expect(leasePresentValue({ ...truck, paymentAtBeginning: false }, 8)).toBeLessThan(leasePresentValue(truck, 8));
  });
  it("does not modify the null-metadata legacy engine", () => {
    const args = [10000, 5, 2, 2, new Date(2026, 0, 1)] as const;
    expect(calculateAmortization(...args)).toEqual(calculateAmortization(...args, 0, [], 0, "monthly", null, 0, "capitalized", {}));
  });
});
