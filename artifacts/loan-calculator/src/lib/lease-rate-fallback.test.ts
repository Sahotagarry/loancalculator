import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssessmentAnswers } from "../components/capital-lease-assessment";
import { LeaseRateFallback } from "../components/lease-rate-fallback";
import { leaseRateGuidance } from "./lease-assessment-values";

const answers: AssessmentAnswers = {
  transferOfOwnership: false, bargainPurchaseOption: false, specializedAsset: false,
  leaseTermPct: 40, pvPctFairValue: 0, fairValue: 139994, assetType: "vehicle", economicLife: 10,
  termMonths: 48, monthlyPayment: 3117.7, downPayment: 0, interestRate: 0, paymentAtBeginning: true,
  paymentIncludesTax: false, taxType: "none", taxRate: 0, buyoutForImplicitRate: 0,
  leaseEndingTerms: { version: 1, kind: "guaranteed_residual", amount: 13322, basis: "stated",
    settlementMonth: 48, source: "Supported ending amount", issues: [], status: "draft",
    taxTreatment: "unresolved",
    commencement: { date: "2026-04-01", basis: "inferred", source: "Agreement date", confirmed: false } },
};
const markup = (a: AssessmentAnswers, estimate?: number | null) =>
  renderToStaticMarkup(createElement(LeaseRateFallback, { guidance: leaseRateGuidance(a, estimate), estimate }));

describe("AI rate estimate as a last-resort reference", () => {
  it("hides the estimate when a rate can be calculated even before review is complete", () => {
    const guidance = leaseRateGuidance(answers, 7);
    expect(guidance.calculatedRate).toBeCloseTo(7.3687834794, 7);
    expect(guidance.showEstimate).toBe(false);
    expect(markup(answers, 7)).toBe("");
  });
  it.each([
    { implicitRate: 8 },
    { implicitRate: 0 },
    { incrementalBorrowingRate: 6 },
    { incrementalBorrowingRate: 0 },
    { discountRate: 5 },
  ])("does not compete with an existing supported rate %j", rate => {
    const a = { ...answers, fairValue: 0, leaseEndingTerms: { ...answers.leaseEndingTerms!, ...rate } };
    expect(leaseRateGuidance(a, 7).showEstimate).toBe(false);
    expect(markup(a, 7)).toBe("");
  });
  it("recognizes a rate read from the document through the legacy rate field", () => {
    expect(leaseRateGuidance({ ...answers, fairValue: 0, interestRate: 6.5 }, 7).showEstimate).toBe(false);
  });
  it("shows a read-only reference only when neither a known nor a calculated rate exists", () => {
    const a = { ...answers, fairValue: 0 };
    const before = JSON.stringify(a);
    const html = markup(a, 7);
    expect(html).toContain("AI estimate for reference only");
    expect(html).toContain("fair value is missing");
    expect(html).toContain("7% annually");
    expect(html).toContain("Enter a supported rate yourself");
    expect(html).toContain("record its source");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Use estimate");
    expect(JSON.stringify(a)).toBe(before);
  });
  it("explains when the ending value needed for pricing is unknown", () => {
    const a = { ...answers, leaseEndingTerms: { ...answers.leaseEndingTerms!, kind: "unresolved" as const, amount: null } };
    expect(leaseRateGuidance(a, 7).showEstimate).toBe(true);
    expect(markup(a, 7)).toContain("supported ending value is missing");
  });
  it.each([null, undefined, 0, -2, NaN, Infinity])("never renders an invalid or missing AI estimate %s", estimate => {
    expect(markup({ ...answers, fairValue: 0 }, estimate)).toBe("");
  });
});
