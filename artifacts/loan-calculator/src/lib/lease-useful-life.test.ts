import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { chooseUsefulLife, withUsefulLife, applyUsefulLifeCategory } from "./lease-useful-life";
import { LeaseUsefulLifeFields } from "@/components/lease-useful-life-fields";
import type { AssessmentAnswers } from "@/components/capital-lease-assessment";

const answers: AssessmentAnswers = {
  transferOfOwnership: false, bargainPurchaseOption: false, specializedAsset: false,
  assetType: "vehicle_heavy", economicLife: 10, termMonths: 48, leaseTermPct: 40,
  monthlyPayment: 3117.7, downPayment: 0, interestRate: 7.36, fairValue: 139994,
  pvPctFairValue: 100, paymentAtBeginning: true, paymentIncludesTax: false,
  taxType: "none", taxRate: 0, buyoutForImplicitRate: 0,
  leaseEndingTerms: { version: 1, kind: "guaranteed_residual", amount: 13322, settlementMonth: 48,
    basis: "stated", source: "Client covers the shortfall.", status: "reviewed", issues: [] },
};

describe("useful-life recommendation priority", () => {
  it("prefers the asset-specific 10-year suggestion over the 12-year truck category", () => {
    expect(chooseUsefulLife(0, 10, "vehicle_heavy")).toEqual({ years: 10, source: "asset_specific" });
  });
  it("works for a broad imported vehicle category with no standard default", () => {
    expect(chooseUsefulLife(0, 10, "vehicle")).toEqual({ years: 10, source: "asset_specific" });
  });
  it.each([6, 8.5, 10])("preserves an existing %s-year life over either suggestion", years => {
    expect(chooseUsefulLife(years, 10, "vehicle_heavy")).toEqual({ years, source: "existing" });
  });
  it.each([null, undefined, 0, -2, NaN, Infinity])("uses the category when the custom suggestion is invalid: %s", suggestion => {
    expect(chooseUsefulLife(0, suggestion, "vehicle_heavy")).toEqual({ years: 12, source: "category" });
  });
  it("leaves unknown cases for manual entry instead of inventing a life", () => {
    expect(chooseUsefulLife(0, null, "vehicle")).toEqual({ years: 0, source: "manual" });
  });
  it("applies a standard only on an explicit picker choice and updates the test", () => {
    const next = applyUsefulLifeCategory(answers, "vehicle_heavy");
    expect(next.economicLife).toBe(12);
    expect(next.leaseTermPct).toBe(33.3);
    expect(next.leaseEndingTerms?.status).toBe("draft");
    expect(answers.economicLife).toBe(10);
    expect(answers.leaseEndingTerms?.status).toBe("reviewed");
  });
  it("preserves a manual override on reopening and when merely identifying the asset type", () => {
    const manual = withUsefulLife(answers, 8);
    const reopened = chooseUsefulLife(manual.economicLife, 10, manual.assetType);
    expect(reopened.years).toBe(8);
    const changedType = withUsefulLife(manual, chooseUsefulLife(manual.economicLife, 10, "vehicle_light").years, "vehicle_light");
    expect(changedType.economicLife).toBe(8);
    expect(changedType.leaseTermPct).toBe(50);
  });
  it("allows an override to be cleared without restoring an unwanted suggestion", () => {
    const cleared = withUsefulLife(answers, 0);
    expect(cleared.economicLife).toBe(0);
    expect(cleared.leaseTermPct).toBe(0);
  });
  it("selecting Other leaves the current number available for a manual override", () => {
    const custom = applyUsefulLifeCategory(answers, "other");
    expect(custom.assetType).toBe("other");
    expect(custom.economicLife).toBe(10);
  });
});

describe("one useful-life field with optional fallbacks", () => {
  const render = (source: "asset_specific" | "existing" | "manual" | "category" = "asset_specific", readOnly = false) =>
    renderToStaticMarkup(createElement(LeaseUsefulLifeFields, {
      years: 10, source, assetType: "vehicle_heavy", reasoning: "Asset-specific trailer working-life explanation.",
      readOnly, onChange: () => {}, onCategory: () => {},
    }));
  it("shows the suggestion in the single field, with category picker and explanation initially closed", () => {
    const html = render();
    expect(html.match(/id="economicLife"/g)).toHaveLength(1);
    expect(html).toContain('value="10"');
    expect(html).toContain("Suggested for this asset");
    expect(html).toContain("Why this suggestion?");
    expect(html).toContain("Use a standard category instead");
    expect(html).not.toContain("Use estimate");
    for (const details of html.match(/<details[^>]*>/g) ?? []) expect(details).not.toContain("open=");
    expect(html.indexOf('id="economicLife"')).toBeLessThan(html.indexOf('id="usefulLifeCategory"'));
    if (process.env.LEASE_USEFUL_LIFE_PREVIEW) writeFileSync(process.env.LEASE_USEFUL_LIFE_PREVIEW,
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css?direct"><link rel="icon" href="data:,"></head><body><main style="max-width:640px;margin:auto;padding:20px"><h1 style="font-size:18px;font-weight:bold;margin-bottom:20px">Criterion 3 — Lease term versus useful life</h1><p style="margin-bottom:16px">Lease term: 48 months</p>${html}<p style="margin-top:16px">48 months ÷ 120 months = <strong>40% of useful life</strong></p></main></body></html>`);
  });
  it("does not mislabel retained or overridden values as the AI recommendation", () => {
    expect(render("existing")).toContain("previously entered value retained");
    expect(render("manual")).toContain("Your override");
    expect(render("category")).toContain("Standard category suggestion");
    expect(render("manual")).not.toContain("Why this suggestion?");
    expect(render("existing")).not.toContain("Suggested for this asset");
    // A manual override must allow selecting the same category again to restore its default.
    expect(render("manual")).toContain('<option value="" disabled="" selected="">');
    expect(render("category")).toContain('<option value="vehicle_heavy" selected="">');
  });
  it("keeps all inputs read-only when the assessment is read-only", () => {
    expect(render("asset_specific", true)).toContain('<fieldset disabled=""');
  });
  it("wires the custom-first selector into initialization without recalculating on every render", () => {
    const source = readFileSync(new URL("../components/capital-lease-assessment.tsx", import.meta.url), "utf8");
    expect(source).toContain("if (open && !prefilledRef.current)");
    expect(source).toContain("const life = chooseUsefulLife(startingAnswers.economicLife");
    expect(source).toContain('setUsefulLifeSource("manual"); updateNumber("economicLife", years)');
    expect(source).toContain("onCategory={applyStandardLife}");
    expect(source).not.toContain("ASSET_TYPE_LIVES[startingAnswers.assetType] ||");
    expect(source).toContain("importedEstimates?.economicLifeReasoning ?? importedEstimates?.reasoning");
  });
  it("keeps the introduction explanatory and collects useful life only in Criterion 3", () => {
    const source = readFileSync(new URL("../components/capital-lease-assessment.tsx", import.meta.url), "utf8");
    const intro = source.slice(source.indexOf("{step === 0 && ("), source.indexOf("{/* Steps 1-5:"));
    expect(intro).toContain("Begin Criterion 1");
    expect(intro).not.toContain("introAssetType");
    expect(intro).not.toContain("What kind of asset is being leased?");
    expect(intro).not.toMatch(/<(Select|Input|LeaseUsefulLifeFields)\b/);
    expect(source).toContain("<LeaseUsefulLifeFields years={answers.economicLife}");
    expect(source).toContain("onCategory={applyStandardLife}");
  });
});
