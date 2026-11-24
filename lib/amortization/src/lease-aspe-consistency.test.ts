import { describe, expect, it } from "vitest";
import { assessLeaseClassification } from "./lease-classification";
import { leaseAssetAmortizationYears, leaseImplicitRate, leasePresentValue, type LeaseEndingTerms } from "./lease-ending";

const ending: LeaseEndingTerms = {
  version: 1, kind: "guaranteed_residual", amount: 13322, basis: "stated",
  source: "Client pays any deficiency below the agreed ending value.", settlementMonth: 48,
  issues: [], status: "reviewed", taxTreatment: "excluded",
};
const cash = { monthlyPayment: 3117.70, termMonths: 48, downPayment: 0, paymentAtBeginning: true, ending };
const rate = leaseImplicitRate(cash, 139994)!;
const loan = { ...cash, leaseEndingTerms: { ...ending, implicitRate: rate }, fairValue: 139994,
  interestRate: rate, paymentTiming: "beginning", assetUsefulLife: 12,
  transferOfOwnership: false, bargainPurchaseOption: false };

describe("ASPE 3065 classification and measurement", () => {
  it("includes the entire guaranteed value, not an expected shortfall, in both PV calculations", () => {
    const result = assessLeaseClassification(loan);
    expect(result.status).toBe("capital");
    expect(result.minimum?.pv).toBeCloseTo(leasePresentValue(cash, rate), 8);
    expect(result.minimum?.percent).toBeCloseTo(100, 8);
    expect(result.rental!.percent).toBeLessThan(100);
    expect(result.payments).toEqual({ rentals: 3117.7 * 48, ending: 13322 });
  });
  it.each(["optional_purchase", "lessor_residual"] as const)("does not include %s in lessee minimum payments", kind => {
    const terms = { ...ending, kind, implicitRate: rate };
    const result = assessLeaseClassification({ ...loan, leaseEndingTerms: terms });
    expect(result.minimum).toEqual(result.rental);
    expect(result.payments?.ending).toBe(0);
    expect(leasePresentValue({ ...cash, ending: terms }, rate)).toBeCloseTo(result.minimum!.pv);
  });
  it("accounts for unguaranteed residual in the implicit rate, but not the formal lessee test", () => {
    const terms = { ...ending, kind: "lessor_residual" as const };
    const implicit = leaseImplicitRate({ ...cash, ending: terms }, 139994)!;
    const result = assessLeaseClassification({ ...loan, leaseEndingTerms: { ...terms, implicitRate: implicit } });
    expect(result.minimum!.percent).toBeLessThan(100);
    expect(result.minimum!.pv).toBeCloseTo(leasePresentValue({ ...cash, ending: terms }, implicit));
    expect(leasePresentValue({ ...cash, ending: terms }, implicit, true)).toBeCloseTo(139994);
  });
  it("includes a reviewed bargain purchase price as well as treating it as a separate classification basis", () => {
    const terms = { ...ending, kind: "bargain_purchase" as const, implicitRate: rate };
    const result = assessLeaseClassification({ ...loan, bargainPurchaseOption: true, leaseEndingTerms: terms });
    expect(result.minimum!.percent).toBeCloseTo(100);
    expect(result.reasons).toContain("Bargain purchase option — separate assessment basis");
    expect(result.reasons).toContain("Minimum lease payments meet the 90% guideline");
  });
  it("does not approve draft or unresolved ending evidence even if rent alone passes", () => {
    for (const terms of [{ ...ending, status: "draft" as const }, { ...ending, kind: "unresolved" as const }]) {
      const result = assessLeaseClassification({ ...loan, fairValue: 100000, leaseEndingTerms: terms });
      expect(result.status).toBe("needs_review");
      expect(result.minimum).toBeNull();
    }
  });
  it("uses the lower supported discount rate", () => {
    const result = assessLeaseClassification({ ...loan, leaseEndingTerms: { ...ending, implicitRate: rate, incrementalBorrowingRate: rate / 2 } });
    expect(result.minimum!.pv).toBeCloseTo(leasePresentValue(cash, rate / 2));
    expect(result.minimum!.percent).toBeGreaterThan(100);
  });
});

describe("ASPE 3065.17 asset amortization, with historical protection", () => {
  const reviewed = { ...loan, isCapitalLease: true, leaseEndingTerms: { ...ending, assetAmortizationPolicy: "aspe_3065" as const } };
  it("uses the lease term without ownership transfer or a bargain purchase", () => {
    expect(leaseAssetAmortizationYears(reviewed)).toBe(4);
    expect(leaseAssetAmortizationYears({ ...reviewed, termMonths: 42 })).toBe(3.5);
  });
  it("uses economic life if ownership transfers or a bargain purchase exists", () => {
    expect(leaseAssetAmortizationYears({ ...reviewed, transferOfOwnership: true })).toBe(12);
    expect(leaseAssetAmortizationYears({ ...reviewed, bargainPurchaseOption: true })).toBe(12);
  });
  it("does not change legacy saved depreciation without deliberate reassessment", () => {
    expect(leaseAssetAmortizationYears({ ...loan, isCapitalLease: true })).toBe(12);
    expect(leaseAssetAmortizationYears({ ...loan, isCapitalLease: true, leaseEndingTerms: null })).toBe(12);
  });
});
