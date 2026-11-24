import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LeaseOpeningSummary, leaseEndingSummary } from "../components/lease-opening-summary";
import { LeaseEndingFields } from "../components/lease-ending-fields";
import { LeaseReviewDetails } from "../components/lease-review-details";
import { LeaseSaveStatus } from "../components/lease-save-status";
import { LeaseCalculationAvailability } from "../components/lease-calculation-availability";
import { leaseScheduleCounts } from "./schedule-display";
import { calculateLeaseSchedule } from "@workspace/amortization";
import type { LeaseEndingTerms } from "@workspace/amortization";
import type { AssessmentAnswers } from "../components/capital-lease-assessment";
import { assessmentConclusion, calculatePVFromAnswers, normalizedAssessmentAnswers, assessmentPaymentSaveValues } from "./lease-assessment-values";
import { readFileSync } from "node:fs";

const ending: LeaseEndingTerms = {
  version: 1, kind: "guaranteed_residual", amount: 8949.50, basis: "stated",
  source: "Synthetic agreement: client covers sale shortfall.", settlementMonth: 48,
  issues: [], status: "reviewed", implicitRate: 7.5306177, discountRate: 7.5306177,
};
const answers = {
  leaseEndingTerms: ending, transferOfOwnership: false, bargainPurchaseOption: false,
  specializedAsset: false, termMonths: 48, economicLife: 10, monthlyPayment: 2003.24,
  interestRate: 7.5306177, downPayment: 0, fairValue: 95000, paymentAtBeginning: true,
  paymentIncludesTax: false, taxRate: 0, taxType: "none", assetType: "vehicle_heavy",
  leaseTermPct: 40, pvPctFairValue: 0, buyoutForImplicitRate: 0,
} satisfies AssessmentAnswers;
const opening = (a: AssessmentAnswers, classificationChanged = false) => renderToStaticMarkup(createElement(LeaseOpeningSummary, {
  pvValue: calculatePVFromAnswers(a), fairValue: a.fairValue, downPayment: a.downPayment,
  ending: a.leaseEndingTerms, classificationChanged,
}));

describe("plain-language lease review components", () => {
  it("replaces the property shortcut with the full evidence collection route", () => {
    const source = readFileSync(new URL("../components/capital-lease-assessment.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/Conclude Operating Lease|setUsedFastTrack|fastTrackConfirm/);
    expect(source).toContain("Property lease — evidence required");
    expect(source).toContain("onClick={() => setStep(1)}");
    expect(source).toContain('aria-controls={`criterion-guide-${i}`}');
  });
  it("uses minimum lease payments as the formal test, with rent-only evidence supplementary", () => {
    const conclusion = assessmentConclusion({ ...answers, fairValue: 89949.50 });
    expect(conclusion.rental?.percent).toBeCloseTo(92.6, 1);
    expect(conclusion.required?.percent).toBeCloseTo(100, 1);
    expect(conclusion.minimum?.percent).toBeCloseTo(100, 1);
    expect(conclusion.reasons).toContain("Minimum lease payments meet the 90% guideline");
    const source = readFileSync(new URL("../components/capital-lease-assessment.tsx", import.meta.url), "utf8");
    const assessment = source.slice(source.indexOf("{/* Step 6:"), source.indexOf("{/* Step 7:"));
    expect(assessment).toContain("<LeasePaymentTest conclusion={conclusion}");
    expect(assessment.indexOf("Supplementary rent-only comparison")).toBeGreaterThan(assessment.indexOf('<LeaseReviewDetails title="Classification tests and evidence"'));
  });
  it("counts 48 rentals separately from the unpaid settlement accrual without assuming a buyout", () => {
    const result = calculateLeaseSchedule({
      monthlyPayment: 2003.24, termMonths: 48, downPayment: 0,
      paymentAtBeginning: true, ending, annualRate: 7.5306177,
      startDate: new Date(2026, 0, 1),
    });
    expect(result.schedule).toHaveLength(49);
    expect(leaseScheduleCounts(result.schedule)).toEqual({ rentals: 48, settlementAccruals: 1 });
    expect(result.schedule.at(-1)?.payment).toBe(0);
    expect(result.schedule.at(-1)?.balance).toBeCloseTo(8949.50, 2);
    const exceptionalRows = [
      { ...result.schedule[0], isGrace: true, payment: 0 },
      { ...result.schedule[0], rowType: "principal_event" as const },
    ];
    expect(leaseScheduleCounts(exceptionalRows)).toEqual({ rentals: 0, settlementAccruals: 0 });
  });
  it("does not render unavailable calculation children as zero balances", () => {
    const html = renderToStaticMarkup(createElement(LeaseCalculationAvailability, { unavailable: true, children: "$0.00 / 0 periods" }));
    expect(html).toContain("Calculation unavailable — review required");
    expect(html).not.toContain("$0.00");
    expect(html).not.toContain("0 periods");
    expect(renderToStaticMarkup(createElement(LeaseCalculationAvailability, { unavailable: false, children: "$2,003.24" }))).toContain("$2,003.24");
    const fileSource = readFileSync(new URL("../pages/file-detail.tsx", import.meta.url), "utf8");
    const renderCard = fileSource.slice(fileSource.indexOf("const renderCard ="), fileSource.indexOf("const getDebtMetrics ="));
    const card = renderCard.slice(renderCard.indexOf("<CardContent"));
    expect(card.indexOf("leaseScheduleSupportIssue(loan)")).toBeLessThan(card.indexOf("if (isOperatingLease)"));
    expect(card).toContain("result.evidenceMetadata?.accountingUnavailable === true");
    expect(card).toContain("<LeaseCalculationAvailability unavailable />");
  });
  it("shows draft versus ready beside save, while incomplete required fields cannot appear ready", () => {
    const status = (terms: LeaseEndingTerms, validationError: string | null = null) =>
      renderToStaticMarkup(createElement(LeaseSaveStatus, { ending: terms, validationError }));
    expect(status({ ...ending, status: "draft" })).toContain("Draft lease — saving keeps accounting");
    expect(status(ending)).toContain("Ready to save");
    expect(status(ending, "Inception date is required")).not.toContain("Ready to save");
    expect(status(ending, "Inception date is required")).toContain("complete the required fields");
    const fields = readFileSync(new URL("../components/loan-form-fields.tsx", import.meta.url), "utf8");
    expect(fields).toContain('"startDate"');
    expect(fields).toContain('status: "draft"');
    expect(fields).toContain("Draft ending terms: saving is allowed");
  });
  it("shows truck opening amounts first, explains the guarantee, and never repeats classification percentages", () => {
    const conclusion = assessmentConclusion(answers);
    expect(conclusion.status).toBe("capital");
    expect(conclusion.rental?.percent).toBeCloseTo(87.7, 1);
    expect(conclusion.required?.percent).toBeCloseTo(94.7, 1);
    expect(calculatePVFromAnswers(answers)).toBe(89949.50);
    const html = opening(answers);
    expect(html).toContain("$89,949.50");
    expect(html).toContain("The client pays the difference if the sale proceeds are below $8,949.50.");
    expect(html.indexOf("Opening amounts to record")).toBeLessThan(html.indexOf("What happens at the end?"));
    expect(html).toContain("before the first rent");
    expect(html).toContain("after any separate upfront payment");
    expect(html).not.toMatch(/87\.7|94\.7|90%|classification percentage/);
  });
  it("shows the upfront payment once in the timing explanation without changing save values", () => {
    const a = { ...answers, downPayment: 2000 };
    const before = JSON.stringify(a);
    const html = opening(a);
    expect(html).toContain("of $2,000.00");
    expect(html).toContain("Do not deduct that upfront payment again");
    const normalized = normalizedAssessmentAnswers(a);
    expect(assessmentPaymentSaveValues(a, true).monthlyPayment).toBe(normalized.monthlyPayment);
    expect(assessmentPaymentSaveValues(a, true).leaseEndingTerms).toEqual(normalized.leaseEndingTerms);
    expect(JSON.stringify(a)).toBe(before);
  });
  it("withholds amounts for a draft or changed classification", () => {
    const draft = { ...answers, leaseEndingTerms: { ...ending, status: "draft" as const, issues: ["Missing return appendix"] } };
    expect(assessmentConclusion(draft).status).toBe("needs_review");
    expect(opening(draft)).toContain("Draft — opening amounts are not ready to record");
    expect(opening(draft)).not.toContain("$89,949.50");
    expect(opening(answers, true)).toContain("Go back and confirm the classification");
    expect(opening(answers, true)).not.toContain("$89,949.50");
    const html = renderToStaticMarkup(createElement(LeaseEndingFields, { value: draft.leaseEndingTerms, months: 48, onChange: () => {} }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Missing return appendix");
    expect(html.indexOf("Resolve before approval")).toBeLessThan(html.indexOf("<details"));
    expect(html).toContain('open=""');
    expect(html).toContain("Evidence still missing or conflicting");
  });
  it("explains a reviewed no-ending-payment lease without implying a purchase", () => {
    const a = { ...answers, transferOfOwnership: true,
      leaseEndingTerms: { ...ending, kind: "none" as const, amount: 0, source: "Return with no payment or guarantee." } };
    expect(assessmentConclusion(a).status).toBe("capital");
    expect(opening(a)).toContain("There is no separate ending payment or sale shortfall guarantee.");
    expect(opening(a)).not.toContain("$8,949.50");
    const fields = renderToStaticMarkup(createElement(LeaseEndingFields, { value: a.leaseEndingTerms, months: 48, onChange: () => {} }));
    expect(fields).not.toContain('open=""');
    expect(fields).toContain("Ending evidence reviewed");
  });
  it("keeps supporting evidence keyboard accessible and legacy review read-only", () => {
    const details = renderToStaticMarkup(createElement(LeaseReviewDetails, { title: "Supporting evidence", children: "Clauses" }));
    expect(details).toContain("<summary");
    expect(details).not.toContain('open=""');
    const html = renderToStaticMarkup(createElement(LeaseEndingFields, { value: ending, months: 48, readOnly: true, onChange: () => {} }));
    expect(html).toContain("<fieldset disabled");
    expect(html).toContain('for="');
    const controls = html.match(/<(?:input|textarea|select)\b[^>]*>/g) ?? [];
    expect(controls).toHaveLength(10);
    for (const control of controls) expect(control).toMatch(/\bname="[^"]+"/);
    expect(leaseEndingSummary({ ...ending, kind: "optional_purchase" })).toContain("not included");
    expect(leaseEndingSummary({ ...ending, kind: "lessor_residual" })).toContain("not included");
  });
  it("keeps measurement on the confirmed next stage and preserves the evidence-bound save gate", () => {
    const source = readFileSync(new URL("../components/capital-lease-assessment.tsx", import.meta.url), "utf8");
    const assessment = source.slice(source.indexOf("{/* Step 6:"), source.indexOf("{/* Step 7:"));
    expect(assessment).not.toContain("LeaseOpeningSummary");
    expect(source).toContain("setConfirmedAssessment(assessmentKey); setStep(8)");
    expect(source).toContain("readOnly || changedSinceConclusion || (step === 8 && !result.isCapitalLease)");
    expect(source).not.toContain("being conservative errs toward operating");
    expect(source).toContain("Do not choose a rate to obtain a preferred classification");
  });
});
