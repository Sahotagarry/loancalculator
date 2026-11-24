import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { assessLeaseClassification, type LeaseEndingTerms } from "@workspace/amortization";
import type { DocumentImportResult } from "@workspace/api-client-react";
import { LeasePaymentTest } from "../components/lease-payment-test";
import { buildFieldRows } from "../components/import-document-dialog";
import { LeaseEndingFields } from "../components/lease-ending-fields";

const ending: LeaseEndingTerms = { version: 1, kind: "guaranteed_residual", amount: 13322,
  basis: "stated", source: "Client covers sale shortfall.", settlementMonth: 48, issues: [], status: "reviewed", taxTreatment: "excluded",
  commencement: { date: "2026-04-01", basis: "inferred", confirmed: false, source: "Based on the agreement date—confirm." } };

describe("clear ASPE lease presentation", () => {
  it("lets staff supply a missing import date before approval rather than leaving a read-only final-form dead end", () => {
    const value = { ...ending, commencement: { date: "", basis: "inferred" as const, confirmed: false,
      source: "Enter and confirm the lease start date." } };
    const html = renderToStaticMarkup(createElement(LeaseEndingFields, { value, months: 48, compact: true, onChange: () => {} }));
    expect(html).toContain("Lease start date — enter and confirm");
    expect(html).toContain('name="leaseSuggestedStartDate"');
    expect(html.match(/<input[^>]*name="leaseCommencementConfirmed"[^>]*>/)?.[0]).toContain('disabled=""');
    expect(assessLeaseClassification({ monthlyPayment: 3117.7, termMonths: 48, fairValue: 139994,
      leaseEndingTerms: { ...value, implicitRate: 7.3687834794 } }).status).toBe("needs_review");
  });
  it("shows a draft full-payment comparison and concrete actions, never a rent-only substitute", () => {
    const conclusion = assessLeaseClassification({ monthlyPayment: 3117.7, termMonths: 48, fairValue: 139994, paymentTiming: "beginning",
      leaseEndingTerms: { ...ending, implicitRate: 7.3687834794, status: "draft", taxTreatment: "unresolved" } });
    const html = renderToStaticMarkup(createElement(LeasePaymentTest, { conclusion }));
    expect(html).toContain("90% test (draft)");
    expect(html).toContain("100.0% of fair value");
    expect(html).toContain("13,322");
    expect(html).toContain("would meet");
    expect(html).toContain("not yet approved");
    expect(html).toContain("Confirm or correct the proposed start date");
    expect(html).toContain("Confirm whether the rental includes taxes or services");
    expect(html).not.toContain("rent-only");
    expect(conclusion.minimum).toBeNull();
    expect(conclusion.status).toBe("needs_review");
  });
  it("lists the actual missing values rather than displaying Unavailable", () => {
    const conclusion = assessLeaseClassification({ termMonths: 48, fairValue: 0, monthlyPayment: 3117.7,
      leaseEndingTerms: { ...ending, kind: "unresolved", amount: null, status: "draft" } });
    const html = renderToStaticMarkup(createElement(LeasePaymentTest, { conclusion }));
    expect(html).toContain("Enter the asset");
    expect(html).toContain("Calculate the implicit rate");
    expect(html).toContain("Choose what the client must do");
    expect(html).not.toContain("Unavailable");
    expect(html).not.toContain("0.0%");
  });
  it("explains the precise tax correction and separates calculation blockers from approval confirmations", () => {
    const terms = { ...ending, implicitRate: 7.3687834794, status: "draft" as const, taxTreatment: "recoverable" as const, taxRate: 0 };
    const conclusion = assessLeaseClassification({ termMonths: 48, fairValue: 139994, monthlyPayment: 3117.7, leaseEndingTerms: terms });
    const html = renderToStaticMarkup(createElement(LeasePaymentTest, { conclusion }));
    expect(html).toContain("Needed to calculate:");
    expect(html).toContain("Enter the included tax rate");
    expect(html).toContain("choose Payments exclude taxes");
    expect(html).toContain("Separate confirmations before approval:");
    expect(html).not.toContain("Correct the tax rate and monthly service amount");
  });
  it("enables the included-tax field only when the rental includes recoverable tax", () => {
    const render = (taxTreatment: LeaseEndingTerms["taxTreatment"]) => renderToStaticMarkup(createElement(LeaseEndingFields, {
      value: { ...ending, status: "draft", taxTreatment, taxRate: 0 }, months: 48, onChange: () => {},
    })).match(/<input[^>]*name="leaseTaxRate"[^>]*>/)?.[0];
    expect(render("excluded")).toBeUndefined();
    expect(render("recoverable")).not.toContain('disabled=""');
  });
  it("explains why the review confirmation cannot yet be checked", () => {
    const html = renderToStaticMarkup(createElement(LeaseEndingFields, {
      value: { ...ending, status: "draft", taxTreatment: "unresolved" }, months: 48, onChange: () => {},
    }));
    expect(html).toContain("Before you can confirm this review");
    expect(html).toContain("Confirm or correct the proposed start date");
    expect(html.match(/<input[^>]*name="leaseEndingReviewed"[^>]*>/)?.[0]).toContain('disabled=""');
  });
  it("distinguishes a source-cost fair-value proposal from a separately supplied fair value", () => {
    const result = { classification: "lease", lease: { fairValue: 139994,
      fieldNotes: { fairValue: "Proposed fair value based on stated asset cost: Agreed Cost of Vehicle $139994.00. Confirm." } } } as DocumentImportResult;
    const rows = buildFieldRows(result);
    expect(rows.find(r => r.label === "Proposed fair value — confirm")?.value).toContain("139,994");
    expect(rows.find(r => r.label === "Fair value basis")?.value).toContain("Confirm.");
    const direct = buildFieldRows({ ...result, lease: { ...result.lease!, fieldNotes: { fairValue: "Independent appraisal" } } });
    expect(direct.find(r => r.label === "Fair value")?.value).toContain("139,994");
    expect(direct.some(r => r.label === "Proposed fair value — confirm")).toBe(false);
  });
  it("shows the proposed date in the main date row without falsely confirming it", () => {
    const rows = buildFieldRows({ classification: "lease", lease: { startDate: null, buyoutAmount: null, leaseEndingTerms: ending } } as DocumentImportResult);
    expect(rows).toContainEqual({ label: "Proposed start date — confirm", value: "2026-04-01" });
    expect(rows.find(r => r.label === "Start date basis")?.value).toBe(ending.commencement!.source);
    expect(rows.some(r => /buyout|purchase option amount/i.test(r.label))).toBe(false);
    expect(rows.find(r => r.label === "Guaranteed end-of-term value")?.value).toContain("13,322");
    expect(ending.commencement!.confirmed).toBe(false);
  });
  it("does not replace a documented start date with an inferred agreement date", () => {
    const rows = buildFieldRows({ classification: "lease", lease: { startDate: "2026-04-03", leaseEndingTerms: ending } } as DocumentImportResult);
    expect(rows[4]).toEqual({ label: "Start date", value: "2026-04-03" });
  });
  it("shows the formal breakdown and rate-calculation explanation, not an opening asset amount", () => {
    const conclusion = assessLeaseClassification({ monthlyPayment: 1000, termMonths: 12, fairValue: 13000, paymentTiming: "beginning",
      transferOfOwnership: false, bargainPurchaseOption: false, leaseEndingTerms: { ...ending, amount: 1000, settlementMonth: 12, commencement: undefined, discountRate: 0 } });
    const html = renderToStaticMarkup(createElement(LeasePaymentTest, { conclusion }));
    expect(html).toContain("Total minimum lease payments (before discounting)");
    expect(html).toContain("100.0% of fair value");
    expect(html).toContain("not independent evidence of fair value");
    expect(html).toContain("full guaranteed residual");
    expect(html).not.toContain("Opening amounts");
  });
});
