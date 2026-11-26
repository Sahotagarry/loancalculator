import { afterEach, describe, expect, it, vi } from "vitest";
import { LEASE_RATE_GUIDANCE, verifyLeaseFinancingRate } from "./import-lease-rate";
import { extractLoanOrLease } from "./azure-extract";
import type { AzureSettings } from "./azure-settings";

afterEach(() => vi.unstubAllGlobals());
const schedule = `PAYMENT SCHEDULE
Basic term: 36 months. Monthly rent: $6,412.47. Payments in advance.
Index Rate (%): 2.57530%
Index Rate Date: March 31, 2026
Rental Factor (%)
2.9825%
The lessor may reset the rental factor before commencement.`;

describe("lease pricing percentages versus financing rates", () => {
  it.each([2.5753, 2.9825])("rejects a mistaken pricing percentage %s", rate => {
    expect(verifyLeaseFinancingRate(schedule, rate)).toMatchObject({ rate: null, warning: expect.any(String) });
  });
  it.each([
    ["INDEX RATE (%): 3.125", 3.125],
    ["Rental factor: 1.75%", 1.75],
    ["Lease rental factor (%)\n 4.1250 %", 4.125],
    ["Reference rate: 3.5 percent", 3.5],
  ] as const)("handles label and OCR spacing variants: %s", (text, rate) => {
    expect(verifyLeaseFinancingRate(text, rate).rate).toBeNull();
  });
  it.each(["Annual interest rate: 2.57530%", "Implicit rate (%): 2.57530",
    "Interest rate (per annum): 2.57530%", "Financing rate: 2.57530%"])(
    "keeps independent financing evidence even with an equal pricing percentage: %s", clause => {
      expect(verifyLeaseFinancingRate(`${schedule}\n${clause}`, 2.5753)).toEqual({ rate: 2.5753, warning: null });
    });
  it.each(["Default interest rate: 2.57530%", "Overdue interest rate: 2.57530%",
    "Interest rate: 2.57530% on overdue amounts"])("does not use penalty evidence: %s", clause => {
    expect(verifyLeaseFinancingRate(`${schedule}\n${clause}`, 2.5753).rate).toBeNull();
  });
  it("preserves a different financing rate, missing rate and documents without pricing evidence", () => {
    expect(verifyLeaseFinancingRate(schedule, 7.25)).toEqual({ rate: 7.25, warning: null });
    expect(verifyLeaseFinancingRate(schedule, null)).toEqual({ rate: null, warning: null });
    expect(verifyLeaseFinancingRate("Annual interest rate: 6.5%", 6.5).rate).toBe(6.5);
    expect(verifyLeaseFinancingRate("Index Rate Date: March 31, 2026", 3).rate).toBe(3);
  });
});

describe("extraction boundary with simulated provider responses", () => {
  const settings = { openaiEndpoint: "https://example.invalid", openaiDeployment: "test" } as AzureSettings;
  function respond(rate: number | null, note = "Index Rate: 2.57530%", ending?: Record<string, unknown>) {
    const mock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      classification: "lease", confidence: 0.95, reasoning: "Equipment lease.",
      lease: { interestRate: rate, monthlyPayment: 6412.47, paymentAtBeginning: true,
        fieldNotes: { interestRate: note }, leaseEndingTerms: ending },
    }) } }] }));
    vi.stubGlobal("fetch", mock);
    return mock;
  }
  it("sends specific guidance and clears misidentified rates and their misleading source notes", async () => {
    const mock = respond(2.5753, "Annual financing rate 2.57530%"); // AI citation alone is not proof.
    const result = await extractLoanOrLease(settings, schedule);
    expect(JSON.parse(mock.mock.calls[0][1].body).messages[0].content).toContain(LEASE_RATE_GUIDANCE);
    expect(result.lease?.interestRate).toBeNull();
    expect(result.lease?.fieldNotes).not.toHaveProperty("interestRate");
    expect(result.reasoning).toContain("excluded from the financing rate");
    expect(result.lease?.monthlyPayment).toBe(6412.47);
    expect(result.lease?.paymentAtBeginning).toBe(true);
  });
  it("rejects a rental factor even when the response provides no citation", async () => {
    respond(2.9825, "");
    expect((await extractLoanOrLease(settings, schedule)).lease?.interestRate).toBeNull();
  });
  it("retains a separately stated equal financing rate and its citation", async () => {
    const clause = "Annual interest rate: 2.57530%";
    respond(2.5753, clause);
    const result = await extractLoanOrLease(settings, `${schedule}\n${clause}`);
    expect(result.lease?.interestRate).toBe(2.5753);
    expect(result.lease?.fieldNotes?.interestRate).toBe(clause);
    expect(result.reasoning).not.toContain("excluded");
  });
  it("leaves a correctly missing financing rate missing without inventing one", async () => {
    respond(null, "");
    const result = await extractLoanOrLease(settings, schedule);
    expect(result.lease?.interestRate).toBeNull();
    expect(result.lease?.fairValue).toBeNull();
    expect(result.reasoning).not.toContain("excluded");
  });
  it("also blocks pricing rates hidden in optional ending metadata", async () => {
    respond(null, "", { version: 1, kind: "lessor_residual", amount: 10000, basis: "stated",
      source: "Synthetic residual evidence", status: "draft", issues: [], settlementMonth: 36,
      implicitRate: 2.5753, discountRate: 2.9825, implicitRateBasis: "calculated" });
    const result = await extractLoanOrLease(settings, schedule);
    expect(result.lease?.leaseEndingTerms?.implicitRate).toBeNull();
    expect(result.lease?.leaseEndingTerms?.discountRate).toBeNull();
    expect(result.lease?.leaseEndingTerms).not.toHaveProperty("implicitRateBasis");
    expect(result.lease?.leaseEndingTerms?.amount).toBe(10000);
    expect(result.reasoning).toContain("excluded from the financing rate");
  });
});
