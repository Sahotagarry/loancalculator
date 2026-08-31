import { describe, expect, it } from "vitest";
import {
  deriveFirstPaymentDate,
  getGraceTermPreview,
} from "@/components/loan-form-fields";

describe("payment timing previews", () => {
  it("distinguishes included and added grace in a 60-month term", () => {
    expect(getGraceTermPreview(60, 13, "included")).toEqual({
      repaymentMonths: 47,
      totalContractualMonths: 60,
    });
    expect(getGraceTermPreview(60, 13, "added")).toEqual({
      repaymentMonths: 60,
      totalContractualMonths: 73,
    });
  });

  it("derives beginning and end payments from the grace boundary", () => {
    expect(deriveFirstPaymentDate("2025-01-10", "beginning", 2, "monthly")).toBe("2025-03-10");
    expect(deriveFirstPaymentDate("2025-01-10", "end", 2, "monthly")).toBe("2025-04-10");
    expect(deriveFirstPaymentDate("2025-01-10", "end", 0, "weekly")).toBe("2025-01-17");
    expect(deriveFirstPaymentDate("2025-01-10", "end", 0, "bi-weekly")).toBe("2025-01-24");
  });

  it("uses the next contractual semi-monthly due day after grace", () => {
    expect(deriveFirstPaymentDate("2025-01-10", "end", 1, "semi-monthly", 1, 15)).toBe("2025-02-15");
    expect(deriveFirstPaymentDate("2025-01-31", "end", 1, "semi-monthly", 15, 31)).toBe("2025-03-15");
  });
});