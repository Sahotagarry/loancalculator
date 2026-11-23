import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { updateLeaseSettlementForTerm } from "@workspace/amortization";
import { parseAssetType, formatAssetType, type AssessmentAnswers } from "../components/capital-lease-assessment";
import { LeaseEndingFields } from "../components/lease-ending-fields";
import { applyCalculatedLeaseRate, assessmentAnswersForReview, assessmentRate, changeAssessmentTerm, normalizedAssessmentAnswers } from "./lease-assessment-values";

const answers: AssessmentAnswers = {
  transferOfOwnership: false, bargainPurchaseOption: false, leaseTermPct: 0, pvPctFairValue: 0,
  fairValue: 139994, specializedAsset: false, assetType: "vehicle", economicLife: 12, termMonths: 0,
  monthlyPayment: 3117.70, downPayment: 0, interestRate: 0, paymentAtBeginning: true,
  paymentIncludesTax: false, taxType: "none", taxRate: 0, buyoutForImplicitRate: 13322,
  leaseEndingTerms: { version: 1, kind: "guaranteed_residual", amount: 13322, basis: "stated",
    source: "Anonymous settlement evidence", settlementMonth: 60, issues: [], status: "draft" },
};

describe("asset type handoff", () => {
  it.each(["vehicle", "equipment", "office_commercial", "other"])("accepts the importer's broad asset code %s", type => {
    expect(parseAssetType(type)).toBe(type);
    expect(parseAssetType(formatAssetType(type))).toBe(type);
  });
  it("preserves specific asset types and does not guess an economic life or an unknown category", () => {
    expect(parseAssetType("Heavy Truck / Fleet")).toBe("vehicle_heavy");
    expect(parseAssetType(" Vehicle ")).toBe("vehicle");
    expect(parseAssetType("unrecognized")).toBe("");
  });
});

describe("term and settlement timing handoff", () => {
  it("replaces unreviewed import timing when staff supply the previously missing term", () => {
    const corrected = changeAssessmentTerm(answers, 48);
    expect(corrected.termMonths).toBe(48);
    expect(corrected.leaseTermPct).toBeCloseTo(33.3);
    expect(corrected.leaseEndingTerms).toMatchObject({ settlementMonth: 48, settlementMonthBasis: "lease_end", amount: 13322, status: "draft" });
    expect(answers.leaseEndingTerms!.settlementMonth).toBe(60);
    expect(changeAssessmentTerm(corrected, 72).leaseEndingTerms!.settlementMonth).toBe(72);
  });
  it("preserves a separately entered month, even when it originally matched the term", () => {
    const separate = { ...answers, termMonths: 48, leaseEndingTerms: { ...answers.leaseEndingTerms!, settlementMonth: 48, settlementMonthBasis: "separate" as const } };
    expect(changeAssessmentTerm(separate, 36).leaseEndingTerms!.settlementMonth).toBe(48);
  });
  it("does not silently rewrite historical reviewed timing", () => {
    const reviewed = { ...answers.leaseEndingTerms!, status: "reviewed" as const };
    expect(updateLeaseSettlementForTerm(reviewed, 0, 48)).toMatchObject({ settlementMonth: 60, status: "draft" });
    expect(reviewed.status).toBe("reviewed");
  });
  it("keeps preserved historical timing separate across repeated term edits", () => {
    const reviewed = { ...answers, leaseEndingTerms: { ...answers.leaseEndingTerms!, status: "reviewed" as const } };
    const firstEdit = changeAssessmentTerm(reviewed, 48);
    const cleared = changeAssessmentTerm(firstEdit, 0);
    expect(changeAssessmentTerm(cleared, 36).leaseEndingTerms).toMatchObject({ settlementMonth: 60, settlementMonthBasis: "separate" });
  });
  it("resolves only obsolete machine warnings when the missing term is supplied", () => {
    const value = { ...answers.leaseEndingTerms!, issues: ["A positive whole-month lease term is required.", "Confirm settlement timing at or after the final rental period.", "Check separate evidence."] };
    expect(updateLeaseSettlementForTerm(value, 0, 48).issues).toEqual(["Check separate evidence."]);
  });
  it("keeps default timing blank when the term is cleared", () => {
    const initialized = changeAssessmentTerm(answers, 48);
    expect(changeAssessmentTerm(initialized, 0)).toMatchObject({ termMonths: 0, leaseTermPct: 0, leaseEndingTerms: { settlementMonth: null } });
  });
});

describe("calculated rate handoff", () => {
  it("carries the calculated rate through normalization and reopening without inventing a borrowing rate", () => {
    const selected = applyCalculatedLeaseRate(changeAssessmentTerm(answers, 48), 7.53219);
    expect(selected.interestRate).toBe(7.53219);
    expect(selected.leaseEndingTerms).toMatchObject({ implicitRate: 7.53219, discountRate: 7.53219, settlementMonth: 48 });
    expect(selected.leaseEndingTerms!.incrementalBorrowingRate).toBeUndefined();
    const reopened = assessmentAnswersForReview(normalizedAssessmentAnswers(selected));
    expect(assessmentRate(reopened)).toBe(7.53219);
    expect(reopened.leaseEndingTerms!.implicitRate).toBe(7.53219);
  });
  it("preserves a separate supported borrowing rate and selects the lower rate", () => {
    const withBorrowing = { ...answers, leaseEndingTerms: { ...answers.leaseEndingTerms!, incrementalBorrowingRate: 6 } };
    const selected = applyCalculatedLeaseRate(withBorrowing, 7.53219);
    expect(selected.leaseEndingTerms).toMatchObject({ implicitRate: 7.53219, incrementalBorrowingRate: 6, discountRate: 6 });
    expect(selected.interestRate).toBe(6);
  });
  it("does not let an unreviewed zero borrowing-rate placeholder erase a chosen calculated rate", () => {
    const withPlaceholder = { ...answers, leaseEndingTerms: { ...answers.leaseEndingTerms!, incrementalBorrowingRate: 0 } };
    const selected = applyCalculatedLeaseRate(withPlaceholder, 7.53219);
    expect(selected.interestRate).toBe(7.53219);
    expect(selected.leaseEndingTerms).toMatchObject({ implicitRate: 7.53219, incrementalBorrowingRate: null, discountRate: 7.53219 });
  });
  it("does not erase an already reviewed separate zero-rate conclusion", () => {
    const reviewed = { ...answers, leaseEndingTerms: { ...answers.leaseEndingTerms!, status: "reviewed" as const, incrementalBorrowingRate: 0 } };
    expect(applyCalculatedLeaseRate(reviewed, 7.53219).leaseEndingTerms!.incrementalBorrowingRate).toBe(0);
  });
  it("ignores invalid calculator output and retains the legacy no-ending path", () => {
    expect(applyCalculatedLeaseRate(answers, NaN)).toBe(answers);
    expect(applyCalculatedLeaseRate({ ...answers, leaseEndingTerms: null }, 7).interestRate).toBe(7);
  });
  it("shows the calculated and selected rate without putting it in the borrowing-rate input", () => {
    const selected = applyCalculatedLeaseRate(changeAssessmentTerm(answers, 48), 7.53219);
    const html = renderToStaticMarkup(createElement(LeaseEndingFields, {
      value: selected.leaseEndingTerms, months: 48, onChange: () => {},
    }));
    expect(html).toContain("Calculated lease rate (implicit)");
    expect(html).toContain("Discount rate used");
    expect(html).toContain("7.53219");
    expect(html.match(/<input[^>]*name="leaseBorrowingRate"[^>]*>/)?.[0]).toContain('value=""');
    expect(html).toContain("Lease term:");
    expect(html).toContain("48");
  });
  it("offers an explicit correction for distinct timing rather than hiding it", () => {
    const html = renderToStaticMarkup(createElement(LeaseEndingFields, {
      value: answers.leaseEndingTerms, months: 48, onChange: () => {},
    }));
    expect(html).toContain("Use lease end (48 months)");
    expect(html).toContain('value="60"');
  });
});
