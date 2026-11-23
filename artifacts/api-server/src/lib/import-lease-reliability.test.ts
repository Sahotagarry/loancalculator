import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeLeaseEnding } from "@workspace/amortization";
import { extractionSchema, extractLoanOrLease } from "./azure-extract";
import type { AzureSettings } from "./azure-settings";
import { parseImportedLeaseEnding } from "./import-lease-ending";
import { leaseEndingSchema } from "./lease-ending";
import { leaseRentalTerm } from "./import-lease-rental-term";
import { leaseSourceFacts, recoverLeaseReserveOperands } from "./import-lease-source-facts";
import { verifyDurations } from "./import-durations";
import { anonymousLeaseOcr as doc } from "./test-fixtures/anonymous-lease-ocr";

afterEach(() => vi.unstubAllGlobals());
const reserves = [1979, 2375, 2903, 3299].map((monthlyAmount, i) => ({
  fromMonth: i * 12 + 1, toMonth: (i + 1) * 12, monthlyAmount,
}));
const ending = { version: 1, kind: "guaranteed_residual", amount: null, basis: "reserve", source: "Reserve table and clause 9.",
  baseAmount: 139994, reserves, settlementMonth: 48, issues: [], status: "draft" };

describe("tolerant AI evidence without weakening reviewed lease validation", () => {
  it.each([
    { sumAmounts: null }, { taxTreatment: null }, { explanation: null }, { reserves: null },
    { version: undefined, status: undefined, settlementMonth: undefined, issues: undefined },
    { suggestedTreatment: null, commencement: null, servicesMonthly: null },
  ])("retains other valid evidence when optional fields are blank: %j", extra => {
    const lease = extractionSchema.parse({ classification: "lease", lease: { leaseEndingTerms: { ...ending, ...extra } } }).lease!;
    expect(lease.leaseEndingTerms).toMatchObject({ kind: "guaranteed_residual", baseAmount: 139994, source: ending.source, status: "draft" });
  });
  it("defaults only draft review metadata and records unusable financial fields", () => {
    const parsed = parseImportedLeaseEnding({ ...ending, status: "reviewed", discountRate: "probably 7%", amount: "unknown" })!;
    expect(parsed.status).toBe("draft");
    expect(parsed.amount).toBeNull();
    expect(parsed.reserves).toEqual(reserves);
    expect(parsed.issues.join(" ")).toContain("unusable discount rate");
    expect(parsed.issues.join(" ")).toContain("unusable ending amount");
    expect(() => leaseEndingSchema.parse({ ...ending, sumAmounts: null })).toThrow();
  });
  it("does not manufacture an obligation from missing or malformed details", () => {
    expect(parseImportedLeaseEnding(null)).toBeNull();
    expect(parseImportedLeaseEnding("not an object")).toMatchObject({ kind: "unresolved", amount: null, status: "draft" });
  });
});

describe("actual OCR cell order, whitespace and page footer", () => {
  it("recovers 48 months despite a reordered AI quotation and blank 49–60 template", () => {
    const inventedOrder = "Monthly rental: 1st to 12th months $3117.70 13th to 24th months $3117.70 25th to 36th months $3117.70 37th to 48th months $3117.70";
    expect(doc).not.toContain(inventedOrder);
    expect(leaseRentalTerm(doc, inventedOrder)?.months).toBe(48);
    expect(verifyDurations(doc, { termQuote: "The lease continues until 30 Mar 2030", paymentScheduleQuote: inventedOrder }, "lease").termMonths).toBe(48);
  });
  it.each([
    (s: string) => s.replaceAll("3117.70", "3117.70_______"),
    (s: string) => s.replaceAll("3117.70", "3117. 70"),
    (s: string) => s.replaceAll("3117.70", "3,117.70"),
    (s: string) => s.replaceAll("months - $", "months — $"),
  ])("accepts formatting variation without changing the duration", change => {
    expect(leaseRentalTerm(change(doc))?.months).toBe(48);
  });
  it("still rejects competing values, unreadable cells and conflicting terms", () => {
    expect(leaseRentalTerm(doc.replaceAll("3117.70", "100 200"))).toBeNull();
    expect(leaseRentalTerm(doc.replace("3117.70", "unreadable"))).toBeNull();
    expect(verifyDurations(`Lease term: 60 months.\n${doc}`, {}, "lease").termMonths).toBeNull();
    const warning = verifyDurations(doc.replace("3117.70", "unreadable"), {}, "lease").durationWarnings.join(" ");
    expect(warning).toContain("populated ranges or amounts could not be verified");
  });
});

describe("source-based reserve recovery", () => {
  it("recovers all reserve operands without fabricating missing settlement wording", () => {
    const facts = leaseSourceFacts(doc);
    const original = parseImportedLeaseEnding({ kind: "unresolved", basis: "unsupported" })!;
    const recovered = normalizeLeaseEnding(recoverLeaseReserveOperands(original, facts), 48);
    expect(recovered).toMatchObject({ kind: "unresolved", amount: 13322, baseAmount: 139994, reserves });
    expect(recovered.source).toContain("Monthly Depreciation Reserve");
    expect(recovered.source).not.toContain("FINAL SETTLEMENT");
    expect(recovered.issues).toContain("Ending obligation remains unresolved.");
  });
  it("does not overwrite an actual purchase option with the reserve calculation", () => {
    const purchase = parseImportedLeaseEnding({ ...ending, kind: "optional_purchase", basis: "stated", amount: 1000 })!;
    expect(recoverLeaseReserveOperands(purchase, leaseSourceFacts(doc))).toBe(purchase);
  });
  it("does not choose between conflicting costs or incomplete reserves", () => {
    expect(leaseSourceFacts(doc + "\nAgreed Cost of Vehicle: $100000.00").cost).toBeNull();
    const facts = leaseSourceFacts(doc.replace("2903.00", "unreadable"));
    const original = parseImportedLeaseEnding({ kind: "unresolved", basis: "unsupported" })!;
    expect(recoverLeaseReserveOperands(original, facts)).toBe(original);
  });
});

describe("combined extraction regression matching real provider response variations", () => {
  it("keeps source evidence despite null optional fields, ignores guessed term 60 and does not confirm a signature date", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      classification: "lease", lease: {
        termMonths: 60, startDate: "2026-04-01", expiryDate: "2030-03-30", monthlyPayment: 3117.70,
        fieldNotes: { startDate: "Header agreement date; assumed delivery date." },
        leaseEndingTerms: { ...ending, reserves: null, sumAmounts: null, taxTreatment: null, status: null },
      },
    }) } }] }));
    vi.stubGlobal("fetch", fetch);
    const result = await extractLoanOrLease({ openaiEndpoint: "https://example.invalid", openaiDeployment: "test" } as AzureSettings, doc);
    expect(result.lease).toMatchObject({ termMonths: 48, startDate: null, monthlyPayment: 3117.70,
      leaseEndingTerms: { kind: "guaranteed_residual", amount: 13322, status: "draft", taxTreatment: "unresolved",
        commencement: { date: "2026-04-01", confirmed: false } } });
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages[1].content).toContain("APPLICATION-VERIFIED SOURCE CHECKS");
  });
});
