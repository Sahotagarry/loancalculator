import { afterEach, describe, expect, it, vi } from "vitest";
import { extractLoanOrLease, extractionSchema } from "./azure-extract";
import { LEASE_USEFUL_LIFE_GUIDANCE } from "./lease-useful-life-guidance";
import type { AzureSettings } from "./azure-settings";

afterEach(() => vi.unstubAllGlobals());
const settings = { openaiEndpoint: "https://example.invalid", openaiDeployment: "test", openaiKey: "synthetic-test-key" } as AzureSettings;
const document = `LEASE AGREEMENT made April 1, 2026.
Asset: 2023 non-powered flatdeck trailer with separate mounted equipment.
Monthly rent $3,117.70 in advance for 48 months. Condition and operating hours not stated.
The lessee intends to replace its fleet every four years.
The lessor retains title and the vehicle is to be returned at lease expiry.`;

describe("asset-specific useful-life request and response contract", () => {
  it("sends the complete asset evidence with focused accounting guidance and preserves the separate rationale", async () => {
    const lifeReason = "Non-powered flatdeck trailer identified from the description; model year is an age clue only. Ordinary commercial service is assumed; no inspection condition is asserted.";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ classification: "lease", confidence: 0.95, reasoning: "Vehicle lease.",
        lease: { assetDescription: "2023 non-powered flatdeck trailer with mounted equipment", assetType: "vehicle",
          termMonths: 48, economicLifeYears: null, estimates: { economicLifeYears: 12, economicLifeReasoning: lifeReason,
            interestRate: 7, fairValue: null, reasoning: "Illustrative financing-rate assumption only." } } }) } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await extractLoanOrLease(settings, document);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain(LEASE_USEFUL_LIFE_GUIDANCE);
    expect(body.messages[1].content).toContain(document);
    expect(body.messages[0].content).toContain("economicLifeReasoning");
    expect(result.lease?.economicLifeYears).toBeNull();
    expect(result.lease?.estimates?.economicLifeYears).toBe(12);
    expect(result.lease?.estimates?.economicLifeReasoning).toBe(lifeReason);
    expect(result.lease?.estimates?.reasoning).toContain("financing-rate");
  });
  it("keeps explicitly stated lives distinct from recommended lives and accepts older responses", () => {
    const result = extractionSchema.parse({ classification: "lease", confidence: 0.9, reasoning: "",
      lease: { economicLifeYears: 9, fieldNotes: { economicLifeYears: "Appraisal states nine years." },
        estimates: { economicLifeYears: null, fairValue: null, interestRate: null, reasoning: null } } });
    expect(result.lease?.economicLifeYears).toBe(9);
    expect(result.lease?.estimates?.economicLifeReasoning).toBeUndefined();
  });
  it("requires an asset-specific answer instead of a midpoint, maximum lifespan or desired classification", () => {
    expect(LEASE_USEFUL_LIFE_GUIDANCE).toContain("non-powered flatdeck/semi-trailer");
    expect(LEASE_USEFUL_LIFE_GUIDANCE).toContain("not today's date");
    expect(LEASE_USEFUL_LIFE_GUIDANCE).toContain("NOT proof of the first in-service date");
    expect(LEASE_USEFUL_LIFE_GUIDANCE).toContain("not maximum possible physical survival");
    expect(LEASE_USEFUL_LIFE_GUIDANCE).toContain("more than one owner/user");
    expect(LEASE_USEFUL_LIFE_GUIDANCE).toContain("Do not choose the midpoint");
    expect(LEASE_USEFUL_LIFE_GUIDANCE).toContain("Do not shorten or lengthen life");
    expect(LEASE_USEFUL_LIFE_GUIDANCE).toContain("Do not leave the recommendation blank solely");
  });
});
