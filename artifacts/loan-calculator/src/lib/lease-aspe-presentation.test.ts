import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { assessLeaseClassification, type LeaseEndingTerms } from "@workspace/amortization";
import type { DocumentImportResult } from "@workspace/api-client-react";
import { LeasePaymentTest } from "../components/lease-payment-test";
import { buildFieldRows } from "../components/import-document-dialog";

const ending: LeaseEndingTerms = { version: 1, kind: "guaranteed_residual", amount: 13322,
  basis: "stated", source: "Client covers sale shortfall.", settlementMonth: 48, issues: [], status: "reviewed",
  commencement: { date: "2026-04-01", basis: "inferred", confirmed: false, source: "Based on the agreement date—confirm." } };

describe("clear ASPE lease presentation", () => {
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
