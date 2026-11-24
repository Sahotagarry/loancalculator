import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssessedCapitalLeaseForm } from "../components/assessed-capital-lease-form";
import type { LoanFormState } from "../components/loan-form-fields";
import { resolveLeaseFormChange, leaseCreationMode } from "./lease-form-updates";
import { applyCalculatedLeaseRate, calculateAssessmentImplicitRate } from "./lease-assessment-values";
import type { AssessmentAnswers } from "../components/capital-lease-assessment";

const answers = { fairValue: 139994, monthlyPayment: 3117.7, termMonths: 48, downPayment: 0,
  interestRate: 0, paymentAtBeginning: true, paymentIncludesTax: false, taxRate: 0, buyoutForImplicitRate: 0,
  leaseEndingTerms: { version: 1, kind: "guaranteed_residual", amount: 13322, basis: "stated",
    settlementMonth: 48, source: "Reviewed sale-shortfall clause", status: "draft", issues: [], taxTreatment: "excluded" },
} as AssessmentAnswers;
const rated = applyCalculatedLeaseRate(answers, calculateAssessmentImplicitRate(answers)!);
const form = { ...rated, name: "Synthetic lease", isCapitalLease: true, paymentOverride: 3117.7,
  paymentTiming: "beginning", termYears: 4, assetUsefulLife: 10, leaseAssessmentRate: rated.interestRate,
  rentSteps: [], freeRentMonths: 0, rentEscalationRate: 0,
  leaseEndingTerms: { ...rated.leaseEndingTerms, status: "reviewed" },
} as LoanFormState;

describe("lease final-form authority", () => {
  it("presents identifying fields and carried amounts instead of another generic loan calculation", async () => {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(AssessedCapitalLeaseForm, { form: { ...form, startDate: "2026-04-01", assetCost: 139994,
        counterparty: "Synthetic lessor", description: "Synthetic description" }, setForm: () => {}, onReview: () => {} })));
    expect(html).toContain("Calculation carried forward from assessment");
    expect(html).toContain("Change lease assessment");
    expect(html).toContain("139,994");
    expect(html).toContain('for="assessed-lease-lessor"');
    expect(html).not.toContain('id="principal"');
    expect(html).not.toContain('id="interestRate"');
    if (process.env.LEASE_FINAL_FORM_PREVIEW) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.LEASE_FINAL_FORM_PREVIEW,
        `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css?direct"></head><body><main style="max-width:640px;margin:auto;padding:16px"><h1 style="font-weight:bold;margin-bottom:12px">Create capital lease</h1>${html}</main></body></html>`);
    }
  });
  it.each([
    [true, true, "capital_lease"], [true, false, "loan"], [false, true, "loan"], [false, false, "loan"],
  ] as const)("routes new records to the correct form with lease=%s and assessment=%s", (lease, assessment, mode) => {
    expect(leaseCreationMode(lease, assessment)).toBe(mode);
  });
  it("makes a manual rate change authoritative instead of letting old metadata overwrite it", () => {
    const next = resolveLeaseFormChange(form, { ...form, interestRate: 9 });
    expect(next.leaseAssessmentRate).toBe(9);
    expect(next.leaseEndingTerms).toMatchObject({ discountRate: 9, implicitRate: null, incrementalBorrowingRate: null, status: "draft" });
    expect(next.leaseEndingTerms?.implicitRateBasis).toBeUndefined();
  });
  it("reprices calculated rates for edited financing rentals and requires review again", () => {
    const next = resolveLeaseFormChange(form, { ...form, paymentOverride: 3300 });
    expect(next.interestRate).not.toBe(form.interestRate);
    expect(next.leaseEndingTerms?.implicitRate).toBe(next.interestRate);
    expect(next.leaseEndingTerms?.status).toBe("draft");
  });
  it("retains reviewed status when only identifying information changes", () => {
    const next = resolveLeaseFormChange(form, { ...form, name: "Corrected lease name" });
    expect(next.leaseEndingTerms).toBe(form.leaseEndingTerms);
  });
  it("does not substitute a zero rate when the rate entry is cleared", () => {
    const next = resolveLeaseFormChange(form, { ...form, interestRate: "" });
    expect(next.leaseEndingTerms?.discountRate).toBeNull();
    expect(next.leaseAssessmentRate).toBeUndefined();
    expect(next.interestRate).toBe("");
  });
  it("preserves loan-only forms without introducing lease semantics", () => {
    const loan = { ...form, leaseEndingTerms: null, isCapitalLease: false };
    const next = { ...loan, interestRate: 8 };
    expect(resolveLeaseFormChange(loan, next)).toBe(next);
  });
});
