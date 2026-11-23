import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeLeaseEnding, type LeaseEndingTerms } from "@workspace/amortization";
import { addLeaseEndingSuggestion } from "./import-lease-suggestion";
import { leaseEndingSchema, validateLeaseEnding } from "./lease-ending";
import { extractLoanOrLease } from "./azure-extract";
import type { AzureSettings } from "./azure-settings";

afterEach(() => vi.unstubAllGlobals());

const ending = (): LeaseEndingTerms => normalizeLeaseEnding({
  version: 1, kind: "unresolved", amount: null, basis: "reserve", baseAmount: 139994,
  reserves: [1979, 2375, 2903, 3299].map((monthlyAmount, i) => ({ fromMonth: 12 * i + 1, toMonth: 12 * (i + 1), monthlyAmount })),
  source: "Agreed vehicle cost and monthly depreciation reserve table.", settlementMonth: 48, issues: [], status: "draft",
}, 48);

describe("best assessment from incomplete lease evidence", () => {
  it("never lets an AI recommendation approve itself in the actual import flow", async () => {
    const candidate = { ...ending(), kind: "guaranteed_residual", status: "reviewed",
      suggestedTreatment: { kind: "guaranteed_residual", reason: "Declining reserve pattern; settlement clause not supplied.", accepted: true } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      classification: "lease", lease: { termMonths: 48, monthlyPayment: 3117.70, leaseEndingTerms: candidate },
    }) } }] })));
    const result = await extractLoanOrLease({ openaiEndpoint: "https://example.invalid", openaiDeployment: "test" } as AzureSettings,
      "Lease term: 48 months. Agreed vehicle cost $139994. Monthly depreciation reserve table.");
    expect(result.lease?.leaseEndingTerms).toMatchObject({ kind: "unresolved", status: "draft", amount: 13322,
      suggestedTreatment: { kind: "guaranteed_residual", accepted: false } });
  });
  it("keeps the calculated value and offers a useful, explicitly unconfirmed treatment", () => {
    const result = addLeaseEndingSuggestion(ending(), "Monthly depreciation reserve");
    expect(result).toMatchObject({ kind: "unresolved", amount: 13322, suggestedTreatment: {
      kind: "guaranteed_residual", accepted: false, reason: expect.stringContaining("not a stated buyout"),
    } });
    expect(leaseEndingSchema.parse(result).suggestedTreatment).toEqual(result.suggestedTreatment);
    expect(() => validateLeaseEnding({ ...result, status: "reviewed" }, 48)).toThrow();
  });
  it.each([
    "The lessee is not liable for any sale shortfall.",
    "The leasing company exclusively bears all residual risk.",
  ])("does not suggest a guarantee against contrary wording: %s", doc => {
    expect(addLeaseEndingSuggestion(ending(), doc).suggestedTreatment).toBeUndefined();
    expect(addLeaseEndingSuggestion({ ...ending(), suggestedTreatment: { kind: "guaranteed_residual", reason: "AI interpretation", accepted: false } }, doc).suggestedTreatment).toBeUndefined();
  });
  it("does not override confirmed terms, unresolved amounts or conflicts with a reserve-based guess", () => {
    expect(addLeaseEndingSuggestion({ ...ending(), kind: "lessor_residual" }, "").suggestedTreatment).toBeUndefined();
    expect(addLeaseEndingSuggestion({ ...ending(), amount: null }, "").suggestedTreatment).toBeUndefined();
    expect(addLeaseEndingSuggestion({ ...ending(), issues: ["Conflicting settlement alternatives."] }, "").suggestedTreatment).toBeUndefined();
  });
  it("does not manufacture a recommendation solely from a leasing company name", () => {
    expect(addLeaseEndingSuggestion({ ...ending(), basis: "unsupported", amount: null }, "Example Leasing Ltd.").suggestedTreatment).toBeUndefined();
  });
});
