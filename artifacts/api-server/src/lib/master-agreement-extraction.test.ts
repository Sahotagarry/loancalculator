import { describe, it, expect } from "vitest";
import { extractionSchema } from "./azure-extract";

describe("master agreement extraction schema", () => {
  it("parses a master_agreement classification with facilities", () => {
    const parsed = extractionSchema.parse({
      classification: "master_agreement",
      confidence: 0.9,
      reasoning: "Commitment letter with two term facilities.",
      loan: null,
      lease: null,
      masterAgreement: {
        lender: "Royal Bank",
        description: "Master credit agreement dated June 1, 2026",
        facilityLimit: 5000000,
        securityDescription: "GSA over all present and after-acquired property",
        covenantDescription: "DSCR not less than 1.25:1",
      },
      facilities: [
        {
          name: "Facility A — Term Loan",
          lender: "Royal Bank",
          principal: 2000000,
          interestRate: 6.2,
          amortizationYears: 10,
          termYears: 5,
          startDate: "2026-06-01",
        },
        {
          name: "Facility B — Equipment Loan",
          lender: "Royal Bank",
          principal: 500000,
          interestRate: null,
          primeSpread: 1.5,
        },
      ],
    });
    expect(parsed.classification).toBe("master_agreement");
    expect(parsed.masterAgreement?.lender).toBe("Royal Bank");
    expect(parsed.facilities).toHaveLength(2);
    expect(parsed.facilities?.[1].primeSpread).toBe(1.5);
  });

  it("tolerates missing master fields via catch defaults", () => {
    const parsed = extractionSchema.parse({
      classification: "master_agreement",
      confidence: 0.4,
      reasoning: "",
      masterAgreement: { lender: 42, facilityLimit: "not a number" },
      facilities: null,
    });
    expect(parsed.masterAgreement?.lender).toBeNull();
    expect(parsed.masterAgreement?.facilityLimit).toBeNull();
    expect(parsed.facilities).toBeNull();
  });

  it("still parses single-loan documents unchanged", () => {
    const parsed = extractionSchema.parse({
      classification: "loan",
      confidence: 0.95,
      reasoning: "Single term loan agreement.",
      loan: { name: "Term Loan", principal: 100000, interestRate: 5 },
      lease: null,
    });
    expect(parsed.classification).toBe("loan");
    expect(parsed.loan?.principal).toBe(100000);
    expect(parsed.masterAgreement).toBeNull();
    expect(parsed.facilities).toBeNull();
  });
});
