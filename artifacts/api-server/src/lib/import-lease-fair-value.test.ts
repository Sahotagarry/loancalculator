import { afterEach, describe, expect, it, vi } from "vitest";
import { proposedLeaseFairValue } from "./import-lease-fair-value";
import { extractLoanOrLease } from "./azure-extract";
import type { AzureSettings } from "./azure-settings";

afterEach(() => vi.unstubAllGlobals());

describe("source-based proposed lease fair value", () => {
  it.each([
    "Agreed Cost of Vehicle: $139994.00",
    "Agreed cost of the equipment: $139,994.00",
    "Cash purchase price: $139994.00",
    "Vehicle cash price: $139994.00",
    "Asset purchase price: $139994.00",
    "Cash price of the equipment: $139994.00",
    "Agreed Cost of Vehicle: $139,994. 00________",
  ])("uses clearly labelled asset cost: %s", text => {
    expect(proposedLeaseFairValue(text)).toMatchObject({
      amount: 139994,
      note: expect.stringContaining("Proposed fair value based on stated asset cost:"),
    });
  });
  it.each([
    "Amount financed: $139994.00",
    "Total lease payments: $139994.00",
    "Capitalized cost: $139994.00",
    "Monthly reserve: $139994.00",
    "Agreed cost: $139994.00",
    "Vehicle cash price: $139994.00 including taxes",
    "Vehicle cash price: $139994.00 (GST included)",
    "Vehicle cash price: $139994.00 includes insurance and financing charges",
    "Total financed: Agreed Cost of Vehicle: $139994.00",
    "Agreed Cost of Vehicle: $0.00",
    "Agreed Cost of Vehicle: $-139994.00",
    "Agreed Cost of Vehicle: $139,99.00",
    "Agreed Cost of Vehicle: $139 994.00",
    "Agreed Cost of Vehicle: $139994.00; Cash price: $140000.00",
  ])("does not substitute a financed, bundled, ambiguous or invalid figure: %s", text => {
    expect(proposedLeaseFairValue(text)).toBeNull();
  });
  it("accepts repeated consistent evidence and other asset costs without special-casing the truck", () => {
    expect(proposedLeaseFairValue("Equipment cash purchase price: $45000.00\nAgreed Cost of Equipment: $45000.00")?.amount).toBe(45000);
  });
});

describe("fair-value recovery after variable AI responses", () => {
  const settings = { openaiEndpoint: "https://example.invalid", openaiDeployment: "test" } as AzureSettings;
  const doc = "Agreed Cost of Vehicle: $139994.00. Lease term: 48 months.";
  const respond = (fairValue: number | null) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    Response.json({ choices: [{ message: { content: JSON.stringify({
      classification: "lease", lease: { fairValue, fieldNotes: fairValue == null ? null : { fairValue: "Separately evidenced fair value" } },
    }) } }] }),
  ));
  it("recovers the proposal with a confirmation note when the AI omits fair value", async () => {
    respond(null);
    const result = await extractLoanOrLease(settings, doc);
    expect(result.lease?.fairValue).toBe(139994);
    expect(result.lease?.fieldNotes?.fairValue).toContain("Confirm this is the asset's cash price");
  });
  it("does not override an existing fair-value entry or its evidence", async () => {
    respond(135000);
    const result = await extractLoanOrLease(settings, doc);
    expect(result.lease?.fairValue).toBe(135000);
    expect(result.lease?.fieldNotes?.fairValue).toBe("Separately evidenced fair value");
  });
  it("does not populate fair value from an unsupported financed total", async () => {
    respond(null);
    const result = await extractLoanOrLease(settings, "Amount financed: $139994.00");
    expect(result.lease?.fairValue).toBeNull();
    expect(result.lease?.fieldNotes?.fairValue).toBeUndefined();
  });
});
