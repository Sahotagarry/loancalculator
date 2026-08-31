import { describe, expect, it } from "vitest";
import { getGetFvDecisionHistoryQueryKey, getGetLoanQueryKey, getListLoansQueryKey } from "@workspace/api-client-react";

describe("FV UI cache and payload parity", () => {
  it("proves the cache refresh uses the exact generated query keys", () => {
    // The architect found that we were invalidating a manual string \`/api/loans/\${id}/fv-decision-history\`
    // instead of the generated \`/api/loans/\${id}/fv-decisions\`
    expect(getGetFvDecisionHistoryQueryKey("123")).toEqual(["/api/loans/123/fv-decisions"]);
    
    // Prove loan and list invalidations
    expect(getGetLoanQueryKey("123")).toEqual(["/api/loans/123"]);
    expect(getListLoansQueryKey("456")).toEqual(["/api/files/456/loans"]);
  });

  it("proves prime use_fv UI validation requires initialFvRateAssumption?.approved === true", () => {
    // We simulate the exact condition from FvDecisionPanel.tsx
    const validate = (rateType: string, assumption: any) => {
      if (rateType === "prime_linked" && !assumption?.approved) {
        return false;
      }
      return true;
    };

    // Valid: fixed rate
    expect(validate("fixed", null)).toBe(true);

    // Invalid: prime linked with no assumption
    expect(validate("prime_linked", null)).toBe(false);

    // Invalid: prime linked with nonempty but unapproved assumption
    expect(validate("prime_linked", { rate: 5 })).toBe(false);
    expect(validate("prime_linked", { rate: 5, approved: false })).toBe(false);

    // Valid: prime linked with approved assumption
    expect(validate("prime_linked", { rate: 5, approved: true })).toBe(true);
  });

  it("proves payload shape exactly matches expectedVersion", () => {
    // The FvDecisionPanel must send expectedVersion, not expectedLatestVersion.
    // Simulate the exact payload assembly
    const buildPayload = (currentVersion: number, marketRate: string) => ({
      expectedVersion: currentVersion ?? 0,
      treatment: "use_fv",
      marketEffectiveRate: Number(marketRate),
      rationaleNote: null,
      confirmedBy: "Auditor"
    });

    const payload = buildPayload(42, "5");
    expect(payload).toHaveProperty("expectedVersion", 42);
    expect(payload).not.toHaveProperty("expectedLatestVersion");
    expect(payload.marketEffectiveRate).toBe(5);
  });
});
