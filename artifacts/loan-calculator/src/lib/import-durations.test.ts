import { describe, expect, it } from "vitest";
import { durationLabel, importedLoanDurations, validImportMonths } from "./import-durations";
import { validateLoanForm, type LoanFormState } from "@/components/loan-form-fields";

describe("imported loan form and review", () => {
  it("opens both selectors in months without filling amortization from the term", () => {
    expect(importedLoanDurations({ termMonths: 60, termYears: 60, amortizationYears: 60 }))
      .toEqual({ importedDurationMonths: true, termYears: 5, amortizationYears: 0 });
  });
  it("does not copy amortization into term or assume a unit for a raw number", () => {
    expect(importedLoanDurations({ termYears: 60, amortizationMonths: 300 }))
      .toMatchObject({ termYears: 0, amortizationYears: 25 });
  });
  it("retains the source units alongside converted months", () => {
    expect(durationLabel(60, "5-year term")).toBe("60 months · “5-year term”");
    expect(durationLabel(null)).toBeNull();
  });
  it("requires positive whole month entries for facilities", () => {
    for (const value of [null, 0, -1, 1.5, Infinity]) expect(validImportMonths(value)).toBe(false);
    expect(validImportMonths(84)).toBe(true);
  });
  it("requires staff to resolve missing amortization before saving a standalone loan", () => {
    const form = { ...importedLoanDurations({ termMonths: 60 }), name: "Fixture", startDate: "2026-01-01",
      interestRate: 6, principal: 100000, downPayment: 0 } as LoanFormState;
    expect(validateLoanForm(form, "loan")).toBe("Amortization is required.");
    expect(validateLoanForm({ ...form, amortizationYears: 7 }, "loan")).toBeNull();
  });
});
