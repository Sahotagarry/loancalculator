import { afterEach, describe, expect, it, vi } from "vitest";
import { leaseRentalTerm } from "./import-lease-rental-term";
import { verifyDurations } from "./import-durations";
import { extractLoanOrLease } from "./azure-extract";
import type { AzureSettings } from "./azure-settings";
import { suggestLeaseCommencement } from "./import-lease-commencement";

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
  it("recovers the source table when an AI quote is missing or reorders two-column rows", () => {
    const rows = "Monthly rental: 1st to 12th months - $3117.70 37th to 48th months - $3117.70 13th to 24th months - $3117.70 49th to 60th months - $_____ 25th to 36th months - $3117.70";
    const doc = `Monthly Depreciation Reserve: 1st to 12th months $1979.00.
      3. TERM: Commences on delivery until 30 Mar 2030.
      4. RENT: The Lessee shall pay monthly in advance the following ${rows}
      The Company shall render a monthly statement.`;
    expect(verifyDurations(doc, {}, "lease")).toMatchObject({ termMonths: 48, durationWarnings: [] });
    expect(verifyDurations(doc, { paymentScheduleQuote: rentals }, "lease").termMonths).toBe(48);
    expect(verifyDurations(doc, { paymentScheduleQuote: "Monthly rental: 1st to 12th months - $3117.70" }, "lease").termMonths).toBe(48);
  });
  it("rejects conflicting source tables and never treats an optional rental as committed", () => {
    expect(leaseRentalTerm("Optional monthly rental: 1 to 12 months $100")).toBeNull();
    expect(leaseRentalTerm("Monthly depreciation reserve: 1 to 12 months $100")).toBeNull();
    const doc = "Monthly rental: 1 to 12 months $100 The Company renders a statement. Monthly rental: 1 to 24 months $100";
    expect(leaseRentalTerm(doc)).toBeNull();
  });
});

describe("suggested agreement dates", () => {
  it("reads the split year on the agreement header without claiming delivery", () => {
    expect(suggestLeaseCommencement("This Agreement made the 1st day of Apr 20 26", "2030-03-30", 48)).toMatchObject({
      date: "2026-04-01", basis: "inferred", confirmed: false,
      source: expect.stringContaining("not a confirmed delivery date"),
    });
  });
  it("works without a known term and retains expiry-only inference as a fallback", () => {
    expect(suggestLeaseCommencement("This agreement dated the 12th day of November 2027", null, null)?.date).toBe("2027-11-12");
    expect(suggestLeaseCommencement("Undated agreement", "2030-03-30", 48)?.date).toBe("2026-03-30");
  });
  it.each(["This Agreement made the 31st day of Apr 20 26", "Invoice dated 1 Apr 2026", "First payment due 1 Apr 2026"])("does not promote unrelated or invalid dates: %s", (doc) => {
    expect(suggestLeaseCommencement(doc, null, null)).toBeNull();
  });
  it("does not choose between conflicting agreement dates", () => {
    expect(suggestLeaseCommencement("This agreement dated 1 Apr 2026. Agreement date: 2 Apr 2026.", null, null)).toBeNull();
  });
});

describe("reserve-based extraction response processing", () => {
  it("calculates a different reserve-based lease after recovering its missing term", async () => {
    const doc = `This Agreement made the 1st day of Apr 20 26.
      Agreed Cost of Vehicle: $139994.00
      Monthly Depreciation Reserve:
      1st to 12th months $1979.00 37th to 48th months $3299.00
      13th to 24th months $2375.00 49th to 60th months $_____
      25th to 36th months $2903.00
      3. TERM: Commences on delivery until 30 Mar 2030.
      4. RENT: The Lessee pays monthly in advance the following monthly rental:
      1st to 12th months $3117.70 37th to 48th months $3117.70
      13th to 24th months $3117.70 49th to 60th months $_____
      25th to 36th months $3117.70
      The Company renders a monthly statement.
      ${shortfall}`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      classification: "lease", lease: {
        startDate: null, termMonths: null, monthlyPayment: 3117.70, buyoutAmount: null,
        leaseEndingTerms: { version: 1, kind: "guaranteed_residual", amount: null,
          basis: "reserve", baseAmount: 139994,
          reserves: [1979, 2375, 2903, 3299].map((monthlyAmount, i) => ({
            fromMonth: i * 12 + 1, toMonth: (i + 1) * 12, monthlyAmount,
          })),
          source: `Agreed cost and monthly depreciation reserve table. ${shortfall}`,
          settlementMonth: 48, issues: [], status: "draft",
        },
      },
    }) } }] })));
    const result = await extractLoanOrLease({ openaiEndpoint: "https://example.invalid", openaiDeployment: "test" } as AzureSettings, doc);
    expect(result.lease).toMatchObject({ termMonths: 48, monthlyPayment: 3117.70, buyoutAmount: null,
      leaseEndingTerms: { kind: "guaranteed_residual", amount: 13322,
        explanation: expect.stringContaining("139994 − reserves 126672 = 13322"),
        status: "draft", commencement: { date: "2026-04-01", confirmed: false } } });
    expect(result.lease!.leaseEndingTerms!.issues).not.toContain("Reserve periods must cover the full term once, with valid monthly amounts not exceeding cost.");
  });
  it("recovers term and suggests the agreement date even when the AI omits both", async () => {
    const doc = `This Agreement made the 1st day of Apr 20 26.
      3. TERM: Commences on delivery until 30 Mar 2030.
      4. RENT: The Lessee pays monthly in advance the following monthly rental:
      1st to 12th months $3117.70 37th to 48th months $3117.70
      13th to 24th months $3117.70 49th to 60th months $_____
      25th to 36th months $3117.70
      The Company renders a monthly statement.`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      classification: "lease", lease: { monthlyPayment: 3117.70, startDate: null, termMonths: null },
    }) } }] })));
    const result = await extractLoanOrLease({ openaiEndpoint: "https://example.invalid", openaiDeployment: "test" } as AzureSettings, doc);
    expect(result.lease).toMatchObject({ termMonths: 48, startDate: null,
      leaseEndingTerms: { status: "draft", commencement: { date: "2026-04-01", basis: "inferred", confirmed: false } } });
  });
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
      suggestedTreatment: { kind: "guaranteed_residual", accepted: false },
      issues: expect.arrayContaining(["Ending obligation remains unresolved."]) });
  });
});
