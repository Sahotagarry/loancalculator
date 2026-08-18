import { describe, it, expect } from "vitest";
import { validateFvRate } from "./loan-validation";

describe("validateFvRate (API save boundary)", () => {
  it("accepts positive finite rates", () => {
    expect(validateFvRate(9.2)).toBeNull();
    expect(validateFvRate(0.01)).toBeNull();
    expect(validateFvRate(25)).toBeNull();
  });

  it("accepts absent rates (no change / no rate)", () => {
    expect(validateFvRate(null)).toBeNull();
    expect(validateFvRate(undefined)).toBeNull();
  });

  it("rejects zero", () => {
    expect(validateFvRate(0)).toMatch(/greater than 0/);
  });

  it("rejects negative rates", () => {
    expect(validateFvRate(-3)).toMatch(/greater than 0/);
  });

  it("rejects non-finite values", () => {
    expect(validateFvRate(Infinity)).toMatch(/finite/);
    expect(validateFvRate(-Infinity)).toMatch(/finite/);
    expect(validateFvRate(NaN)).toMatch(/finite/);
  });

  it("rejects non-number payloads that slip past loose parsing", () => {
    expect(validateFvRate("7" as unknown as number)).toMatch(/finite number/);
  });
});
