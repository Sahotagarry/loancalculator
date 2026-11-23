import { afterEach, describe, expect, it, vi } from "vitest";
import { leaseRentalTerm } from "./import-lease-rental-term";
import { verifyDurations } from "./import-durations";
import { extractLoanOrLease } from "./azure-extract";
import type { AzureSettings } from "./azure-settings";

const rentals = "Monthly rental: 1st to 12th months - $2,003.24 13th to 24th months - $2,003.24 25th to 36th months - $2,003.24 37th to 48th months - $2,003.24 49th to 60th months - $_____";
const reserveText = "Agreed cost: $89,949.50. Monthly Depreciation Reserve: 1st to 12th months $1266; 13th to 24th months $1519; 25th to 36th months $1856; 37th to 48th months $2109.";
const shortfall = "If the Net Sales Proceeds are less than the agreed value, the Lessee shall pay the Company such deficiency.";
const text = `${rentals}\n${reserveText}\n${shortfall}\nTerm ends 30 Mar 2030. Dated March 27, 2026. Commences on delivery.`;
afterEach(() => vi.unstubAllGlobals());

describe("documented monthly rental ranges", () => {
  it("verifies the populated ranges without counting blank template rows", () => {
    expect(verifyDurations(text, { paymentScheduleQuote: rentals }, "lease")).toMatchObject({
      termMonths: 48, durationWarnings: [], termQuote: rentals,
    });
  });
  it.each([
    ["Monthly rental: 1 to 12 months $100 25 to 36 months $100"],
    ["Monthly rental: 1 to 24 months $100 13 to 36 months $100"],
    ["Monthly rental: 1 to 12 months $100 13 to 24 months $_____ 25 to 36 months $100"],
    ["Monthly depreciation reserve: 1 to 12 months $100"],
    ["Optional monthly rental: 1 to 12 months $100"],
    ["Monthly rental: 1 to 12 months $unreadable"],
    ["Monthly rental: 1 to 12 months $0"],
    ["Monthly rental: 1 to 12 months $100 200"],
    ["Monthly rental: 1 to 12 months $1,2.00"],
  ])("leaves unsafe evidence unresolved: %s", (q) => {
    expect(leaseRentalTerm(q, q)).toBeNull();
  });
  it("does not trust invented quotes or override a conflicting explicit term", () => {
    expect(leaseRentalTerm("Monthly rent not legible", rentals)).toBeNull();
    expect(verifyDurations(`Lease term: 60 months. ${rentals}`, { paymentScheduleQuote: rentals }, "lease").termMonths).toBeNull();
    expect(verifyDurations(text, { paymentScheduleQuote: rentals }, "loan").termMonths).toBeNull();
  });
  it("supports other durations and rates, without matching a lender or vehicle", () => {
    const q = "Monthly payments: 1-6 months $800.00 7-18 months $900.00";
    expect(leaseRentalTerm(q, q)?.months).toBe(18);
  });
});

describe("reserve-based extraction response processing", () => {
  async function extract(kind: "guaranteed_residual" | "unresolved", includeClause: boolean) {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      classification: "lease", lease: {
        paymentScheduleQuote: rentals, startDate: null, expiryDate: "2030-03-30",
        monthlyPayment: 2003.24, buyoutAmount: null, interestRate: null,
        leaseEndingTerms: { version: 1, kind, amount: null, basis: "reserve", baseAmount: 89949.50,
          reserves: [1266, 1519, 1856, 2109].map((monthlyAmount, i) => ({
            fromMonth: i * 12 + 1, toMonth: (i + 1) * 12, monthlyAmount,
          })),
          source: reserveText + (includeClause ? shortfall : ""), settlementMonth: 48, issues: [], status: "draft",
        },
      },
    }) } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await extractLoanOrLease({ openaiEndpoint: "https://example.invalid", openaiDeployment: "test" } as AzureSettings,
      includeClause ? text : text.replace(shortfall, ""));
    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(prompt).toContain("buyoutAmount, leaseEndingTerms:");
    expect(prompt).toContain("startDate, expiryDate, termMonths");
    return result.lease!;
  }
  it("computes the ending amount and keeps the shortfall distinct from a buyout", async () => {
    const lease = await extract("guaranteed_residual", true);
    expect(lease).toMatchObject({ termMonths: 48, startDate: null, buyoutAmount: null, interestRate: null,
      leaseEndingTerms: { kind: "guaranteed_residual", amount: 8949.5, status: "draft",
        commencement: { basis: "inferred", confirmed: false } },
    });
  });
  it("retains the calculated value without inventing an obligation when the clause is absent", async () => {
    const lease = await extract("unresolved", false);
    expect(lease.leaseEndingTerms).toMatchObject({ kind: "unresolved", amount: 8949.5, status: "draft",
      issues: expect.arrayContaining(["Ending obligation remains unresolved."]) });
  });
});
