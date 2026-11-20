import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyDurations } from "./import-durations";
import { extractLoanOrLease } from "./azure-extract";
import type { AzureSettings } from "./azure-settings";

const excerpt = `(25) Term of Contract ___60___ months
payable in 60 consecutive Monthly instalments of $2592.68 each (except that the final instalment shall be for the amount then due).
No. of Pmts  Amount of Each Payment   Commencing
60  2592.68  06/11/2026`;
const read = (text: string) => verifyDurations(text, {}, "loan");
afterEach(() => vi.unstubAllGlobals());

describe("durations from documented units", () => {
  it("verifies the sixty-month form without claiming five-year amortization", () => {
    expect(read(excerpt)).toMatchObject({ termMonths: 60, termYears: 5, amortizationMonths: null, amortizationYears: null });
  });
  it.each([
    ["Loan term: five (5) years. Amortization: 25 years.", 60, 300],
    ["5-year term amortized over 84 months.", 60, 84],
    ["Term: 60 months\nAmortization: 84 months", 60, 84],
    ["Term (months): 30. Amortization (years): 2.5.", 30, 30],
    ["The term of this agreement shall be three years.", 36, null],
    ["Borrowing is amortized over 7 years.", null, 84],
    ["Term: 60. Payable in 60 consecutive monthly instalments.", null, null],
    ["Term: 5 years. Revised term: 48 months.", null, null],
    ["Term: 60 years. Payable in 60 consecutive monthly instalments.", null, null],
    ["Term: 60 years. Number of monthly payments: 60.", null, null],
    ["Term: five (7) years.", null, null],
    ["Term: 2 years and six months.", null, null],
    ["Amortization term: 25 years.", null, 300],
    ["Term: 60 months. Optional renewal term: 12 months.", 60, null],
  ])("%s", (text, termMonths, amortizationMonths) => {
    expect(read(String(text))).toMatchObject({ termMonths, amortizationMonths });
  });
  it("keeps lease term evidence and does not treat asset life as the term", () => {
    const r = verifyDurations("Lease term: 4 years. Economic life: 12 years.", {}, "lease");
    expect(r).toMatchObject({ termMonths: 48, termQuote: "Lease term: 4 years", durationWarnings: [] });
  });
  it("never verifies another facility's uncited period or an invented quote", () => {
    const doc = "Facility A — Term: 5 years. Facility B — Term: 18 months. Amortization: 36 months.";
    expect(verifyDurations(doc, { termQuote: "Facility B — Term: 18 months", amortizationQuote: "Amortization: 90 years" }, "facility"))
      .toMatchObject({ termMonths: 18, amortizationMonths: null });
    expect(verifyDurations(doc, {}, "facility").termMonths).toBeNull();
  });
  it("corrects the erroneous AI response in the actual extraction flow", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      classification: "loan", loan: { termYears: 60, amortizationYears: 60 },
    }) } }] })));
    const result = await extractLoanOrLease({ openaiEndpoint: "https://example.invalid", openaiDeployment: "test" } as AzureSettings, excerpt);
    expect(result.loan).toMatchObject({ termMonths: 60, termYears: 5, amortizationMonths: null, amortizationYears: null, durationWarnings: [expect.stringContaining("Amortization")] });
  });
});
