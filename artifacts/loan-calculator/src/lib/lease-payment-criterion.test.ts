import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssessmentAnswers } from "../components/capital-lease-assessment";
import { LeasePaymentCriterion } from "../components/lease-payment-criterion";
import { assessmentConclusion, assessmentAnswersForReview, normalizedAssessmentAnswers, preTaxMonthlyPayment } from "./lease-assessment-values";
import { currentTaxTreatment, changeCriterionTaxTreatment, changeCriterionTaxRate, assessmentStepReady, assessmentEntryStep, assessmentStepBlockers } from "./lease-payment-inputs";

const answers: AssessmentAnswers = {
  transferOfOwnership: false, bargainPurchaseOption: false, specializedAsset: false,
  leaseTermPct: 40, pvPctFairValue: 0, fairValue: 139994, assetType: "vehicle", economicLife: 10,
  termMonths: 48, monthlyPayment: 3117.7, downPayment: 0, interestRate: 7.368783479401797,
  paymentAtBeginning: true, paymentIncludesTax: false, taxType: "none", taxRate: 0, buyoutForImplicitRate: 0,
  leaseEndingTerms: { version: 1, kind: "guaranteed_residual", amount: 13322, basis: "stated",
    source: "Client covers a sale shortfall below the ending value.", settlementMonth: 48, issues: [],
    status: "draft", taxTreatment: "excluded", implicitRate: 7.368783479401797,
    commencement: { date: "2026-04-01", basis: "inferred", confirmed: false, source: "Agreement date; confirm at review." } },
};
function render(a = answers, readOnly = false) {
  return renderToStaticMarkup(createElement(LeasePaymentCriterion, {
    answers: a, setAnswers: () => {}, updateNumber: () => {}, conclusion: assessmentConclusion(a), readOnly,
    importedNotes: { monthlyPayment: "Monthly rental from the agreement.", fairValue: "Proposed value from agreed vehicle cost." },
    importedEstimates: { fairValue: 139994, interestRate: 7 },
    onCalculateRate: () => {},
  }));
}

describe("compact lease-payment criterion", () => {
  it("puts the ending choice and every confirmation before the calculation result", async () => {
    const before = JSON.stringify(answers);
    const html = render();
    expect(html).toContain("100.0% of fair value");
    expect(html).toContain("13,322");
    expect(html).toContain("48 months");
    expect(html).toContain("Calculate implicit rate");
    expect(html).toContain('value="7.36878"');
    expect(html).not.toContain('value="7.368783479401797"');
    expect(html).toContain("Complete the inputs and confirmations above");
    expect(html).toContain("leaseEndingReviewed");
    expect(html).toContain('name="leaseEndingKind"');
    expect(html).toContain('name="leaseEndingAmount"');
    expect(html).toContain('name="leaseCommencementConfirmed"');
    const resultPosition = html.indexOf('data-testid="lease-minimum-payment-test"');
    for (const name of ["leaseEndingKind", "leaseEndingAmount", "leaseCommencementConfirmed", "leaseEndingReviewed"]) {
      expect(html.indexOf(`name="${name}"`)).toBeLessThan(resultPosition);
    }
    expect(html).not.toContain("Edit at classification review");
    expect(html).not.toContain("Confirm at classification review");
    expect((html.match(/name="leaseTaxTreatment"/g) ?? [])).toHaveLength(0);
    expect(html).not.toContain("How to Determine Fair Value");
    expect(html).not.toContain("How to Determine the Right Rate");
    expect(html).not.toContain("Use and verify");
    expect(html).not.toContain("lease-rate-fallback");
    for (const details of html.match(/<details[^>]*>/g) ?? []) expect(details).not.toMatch(/\bopen=/);
    expect(JSON.stringify(answers)).toBe(before);
    if (process.env.LEASE_CRITERION_PREVIEW) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.LEASE_CRITERION_PREVIEW,
        `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css?direct"></head><body><main style="max-width:680px;margin:auto;padding:16px"><h1 style="font-weight:bold;margin-bottom:12px">Minimum lease payments — 90% test</h1>${html}</main></body></html>`);
    }
  });
  it("retains optional payment controls without opening them automatically", () => {
    const html = render({ ...answers, downPayment: 100, firstPaymentAmount: 2000,
      leaseEndingTerms: { ...answers.leaseEndingTerms!, servicesMonthly: 20 } });
    expect(html).toContain("Additional payments (2 entered)");
    for (const id of ["input-first-payment", "input-down-payment", "input-services-monthly"]) expect(html).toContain(id);
    expect(html.match(/<details[^>]*data-testid="details-additional-payments"[^>]*>/)?.[0]).not.toContain("open=");
  });
  it("shows imported tax evidence instead of an unchecked legacy flag", () => {
    const a = { ...answers, paymentIncludesTax: false,
      leaseEndingTerms: { ...answers.leaseEndingTerms!, taxTreatment: "recoverable" as const, taxRate: 0 } };
    expect(currentTaxTreatment(a)).toBe("recoverable");
    const html = render(a);
    expect(html).toContain('<option value="recoverable" selected="">');
    expect(html).toContain("input-tax-rate");
    expect(html).toContain("Enter the included tax rate.");
    expect(html).toContain('name="leaseCommencementConfirmed"');
  });
  it("does not display a tax-rate input when the rental excludes taxes", () => {
    expect(render()).not.toContain("input-tax-rate");
  });
  it("preserves read-only mode for core and optional inputs", () => {
    expect(render(answers, true).match(/<fieldset[^>]*disabled=""[^>]*>/g)).toHaveLength(3);
  });
  it("shows a proposed obligation with an actionable confirmation beside the ending amount", () => {
    const html = render({ ...answers, leaseEndingTerms: { ...answers.leaseEndingTerms!, kind: "unresolved",
      suggestedTreatment: { kind: "guaranteed_residual", reason: "Client covers the sale shortfall.", accepted: false } } });
    expect(html).toContain("Confirm proposed treatment");
    expect(html).toContain("What must the client do at the end?");
    expect(html).toContain('name="leaseEndingAmount"');
  });
  it("does not allow incomplete evidence to be deferred to results", () => {
    expect(assessmentStepReady(answers, 4)).toBe(false);
    expect(assessmentStepReady(answers, 5)).toBe(false);
    expect(assessmentEntryStep(answers, 6)).toBe(4);
    const ready = { ...answers, leaseEndingTerms: { ...answers.leaseEndingTerms!, status: "reviewed" as const,
      commencement: { ...answers.leaseEndingTerms!.commencement!, confirmed: true } } };
    for (const step of [3, 4, 5, 6]) expect(assessmentStepReady(ready, step)).toBe(true);
    expect(assessmentEntryStep(ready, 6)).toBe(6);
    expect(assessmentStepReady({ ...ready, economicLife: 0 }, 3)).toBe(false);
    expect(assessmentEntryStep({ ...ready, economicLife: 0 }, 6)).toBe(3);
    expect(assessmentStepReady({ ...ready, leaseEndingTerms: { ...ready.leaseEndingTerms, taxTreatment: "unresolved" } }, 4)).toBe(false);
    // A different passing test must not expose an unfinished payment test on results.
    expect(assessmentStepReady({ ...ready, transferOfOwnership: true, fairValue: 0 }, 4)).toBe(false);
    expect(assessmentStepReady({ ...ready, economicLife: 4, fairValue: 0 }, 5)).toBe(false);
  });
  it("explains each missing useful-life input instead of leaving Next silently disabled", () => {
    const reasons = assessmentStepBlockers({ ...answers, economicLife: 0, termMonths: 1.5 }, 3);
    expect(reasons).toEqual([
      "Enter an expected useful life greater than zero.",
      "Enter the lease term as a positive whole number of months.",
    ]);
    expect(assessmentStepBlockers({ ...answers, economicLife: 10, termMonths: 48 }, 3)).toEqual([]);
  });
  it("includes specific missing payment inputs even when ownership already supports capital classification", () => {
    expect(assessmentStepBlockers({ ...answers, transferOfOwnership: true, fairValue: 0 }, 4))
      .toContain("Enter the asset's fair value.");
  });
  it("uses the same evidence requirements as Next and identifies the criterion to fix", () => {
    const before = structuredClone(answers);
    const reasons = assessmentStepBlockers(answers, 4);
    expect(reasons.join(" ")).toContain("Criterion 4");
    expect(reasons.join(" ")).not.toContain("below");
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(answers).toEqual(before);
    const ready = { ...answers, leaseEndingTerms: { ...answers.leaseEndingTerms!, status: "reviewed" as const,
      commencement: { ...answers.leaseEndingTerms!.commencement!, confirmed: true } } };
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(assessmentStepBlockers(ready, step).length === 0).toBe(assessmentStepReady(ready, step));
      expect(assessmentStepBlockers(answers, step).length === 0).toBe(assessmentStepReady(answers, step));
    }
  });
});

describe("criterion tax state stays consistent across stages", () => {
  it.each(["excluded", "recoverable", "nonrecoverable", "unresolved"] as const)("preserves the explicit %s choice on normalization and reopening", treatment => {
    const changed = changeCriterionTaxTreatment(answers, treatment);
    expect(changed.paymentIncludesTax).toBe(treatment === "recoverable");
    expect(currentTaxTreatment(changed)).toBe(treatment);
    const reopened = assessmentAnswersForReview(normalizedAssessmentAnswers(changed));
    expect(currentTaxTreatment(reopened)).toBe(treatment);
    expect(reopened.leaseEndingTerms?.status).toBe("draft");
  });
  it("corrects an imported tax mismatch and resolves its calculation blocker without approving review", () => {
    const imported = { ...answers, paymentIncludesTax: false,
      leaseEndingTerms: { ...answers.leaseEndingTerms!, taxTreatment: "recoverable" as const, taxRate: 0 } };
    expect(assessmentConclusion(imported).draftComparison).toBeNull();
    const changed = changeCriterionTaxTreatment(imported, "excluded");
    expect(assessmentConclusion(changed).draftComparison?.minimum.percent).toBeCloseTo(100, 7);
    expect(assessmentConclusion(changed).minimum).toBeNull();
    expect(assessmentConclusion(changed).status).toBe("needs_review");
  });
  it("deducts recoverable tax once and preserves first-rental and gross documentary evidence", () => {
    const changed = changeCriterionTaxRate(changeCriterionTaxTreatment({ ...answers, firstPaymentAmount: 1000 }, "recoverable"), 5);
    expect(changed.leaseEndingTerms).toMatchObject({ grossMonthlyPayment: 3117.7, grossFirstPaymentAmount: 1000, taxRate: 5, status: "draft" });
    expect(preTaxMonthlyPayment(changed)).toBe(2969.24);
    const normalized = normalizedAssessmentAnswers(changed);
    expect(normalized.firstPaymentAmount).toBe(952.38);
    expect(preTaxMonthlyPayment(normalized)).toBe(2969.24);
    expect(preTaxMonthlyPayment(assessmentAnswersForReview(normalized))).toBe(2969.24);
  });
  it("clears a removed included-tax rate without substituting a guessed percentage", () => {
    const a = changeCriterionTaxRate(changeCriterionTaxTreatment(answers, "recoverable"), 5);
    const cleared = changeCriterionTaxRate(a, undefined);
    expect(cleared.leaseEndingTerms?.taxRate).toBeUndefined();
    expect(cleared.taxRate).toBe(0);
    expect(assessmentConclusion(cleared).draftComparison).toBeNull();
  });
  it("supports the legacy no-ending path without inventing new accounting evidence", () => {
    const legacy = { ...answers, leaseEndingTerms: null };
    expect(currentTaxTreatment(legacy)).toBe("excluded");
    const changed = changeCriterionTaxTreatment(legacy, "recoverable");
    expect(currentTaxTreatment(changed)).toBe("recoverable");
    expect(changed.leaseEndingTerms).toBeNull();
  });
});
