import { describe, it, expect } from "vitest";
import {
  resolveSuggestedFvRate,
  resolveEffectiveRate,
  parseFvRateInput,
  canSaveFvRate,
  resolveFvRateForDecision,
} from "./fv-rate";

describe("resolveSuggestedFvRate", () => {
  it("prefers a saved loan.fvRate over the prime + 2% suggestion", () => {
    expect(resolveSuggestedFvRate(5.5, 9.2)).toBe(5.5);
    // Saved rates come back from the API as strings.
    expect(resolveSuggestedFvRate("5.50", 9.2)).toBe(5.5);
  });

  it("falls back to the prime suggestion when nothing is saved", () => {
    expect(resolveSuggestedFvRate(null, 9.2)).toBe(9.2);
    expect(resolveSuggestedFvRate(undefined, 9.2)).toBe(9.2);
    expect(resolveSuggestedFvRate("", 9.2)).toBe(9.2);
  });

  it("returns 0 (unknown) when neither a saved rate nor a suggestion exists", () => {
    expect(resolveSuggestedFvRate(null, null)).toBe(0);
    expect(resolveSuggestedFvRate(undefined, undefined)).toBe(0);
  });

  it("treats malformed saved rates (non-finite, non-positive, non-numeric) as absent", () => {
    expect(resolveSuggestedFvRate("Infinity", 9.2)).toBe(9.2);
    expect(resolveSuggestedFvRate(NaN, 9.2)).toBe(9.2);
    expect(resolveSuggestedFvRate("abc", 9.2)).toBe(9.2);
    expect(resolveSuggestedFvRate(0, 9.2)).toBe(9.2);
    expect(resolveSuggestedFvRate(-5, 9.2)).toBe(9.2);
    // With no usable suggestion either, the rate is unknown.
    expect(resolveSuggestedFvRate("Infinity", null)).toBe(0);
    expect(resolveSuggestedFvRate(null, Infinity)).toBe(0);
    expect(resolveSuggestedFvRate(null, NaN)).toBe(0);
  });
});

describe("resolveEffectiveRate", () => {
  it("uses the FV rate only when the decision is use_fv and the rate is positive", () => {
    expect(resolveEffectiveRate("use_fv", 9.2, 2)).toBe(9.2);
  });

  it("keeps the contractual rate for trivial / immaterial / undecided", () => {
    expect(resolveEffectiveRate("trivial", 9.2, 2)).toBe(2);
    expect(resolveEffectiveRate("immaterial", 9.2, 2)).toBe(2);
    expect(resolveEffectiveRate(null, 9.2, 2)).toBe(2);
    expect(resolveEffectiveRate(undefined, 9.2, 2)).toBe(2);
  });

  it("never applies a non-positive or non-finite FV rate even when use_fv was chosen", () => {
    expect(resolveEffectiveRate("use_fv", 0, 2)).toBe(2);
    expect(resolveEffectiveRate("use_fv", -1, 2)).toBe(2);
    expect(resolveEffectiveRate("use_fv", NaN, 2)).toBe(2);
    expect(resolveEffectiveRate("use_fv", Infinity, 2)).toBe(2);
  });
});

describe("parseFvRateInput", () => {
  it("parses a valid positive rate", () => {
    expect(parseFvRateInput("9.2")).toBe(9.2);
    expect(parseFvRateInput(" 7.25 ")).toBe(7.25);
  });

  it("rejects zero and negative rates", () => {
    expect(parseFvRateInput("0")).toBeNull();
    expect(parseFvRateInput("-3")).toBeNull();
  });

  it("rejects blank and non-numeric input", () => {
    expect(parseFvRateInput("")).toBeNull();
    expect(parseFvRateInput("   ")).toBeNull();
    expect(parseFvRateInput(null)).toBeNull();
    expect(parseFvRateInput(undefined)).toBeNull();
    expect(parseFvRateInput("abc")).toBeNull();
    expect(parseFvRateInput("Infinity")).toBeNull();
  });
});

describe("resolveFvRateForDecision", () => {
  it("freezes a valid typed draft over the suggestion", () => {
    expect(resolveFvRateForDecision("5.5", 9.2)).toBe(5.5);
  });

  it("falls back to a positive suggested/saved rate when the draft is invalid or absent", () => {
    expect(resolveFvRateForDecision(null, 9.2)).toBe(9.2);
    expect(resolveFvRateForDecision("", 9.2)).toBe(9.2);
    expect(resolveFvRateForDecision("0", 9.2)).toBe(9.2);
    expect(resolveFvRateForDecision("-1", 9.2)).toBe(9.2);
  });

  it("returns null (persist no rate) when the suggestion hasn't loaded or is unusable", () => {
    expect(resolveFvRateForDecision(null, 0)).toBeNull();
    expect(resolveFvRateForDecision("", -1)).toBeNull();
    expect(resolveFvRateForDecision("abc", 0)).toBeNull();
    expect(resolveFvRateForDecision(null, NaN)).toBeNull();
    expect(resolveFvRateForDecision(null, Infinity)).toBeNull();
  });
});

describe("canSaveFvRate", () => {
  it("allows saving a new valid rate", () => {
    expect(canSaveFvRate("5.5", 9.2, false)).toBe(true);
  });

  it("blocks non-positive or invalid drafts", () => {
    expect(canSaveFvRate("0", 9.2, false)).toBe(false);
    expect(canSaveFvRate("-2", 9.2, false)).toBe(false);
    expect(canSaveFvRate("", 9.2, false)).toBe(false);
    expect(canSaveFvRate(null, 9.2, false)).toBe(false);
    expect(canSaveFvRate("abc", 9.2, false)).toBe(false);
  });

  it("blocks a no-op save of the rate already in effect", () => {
    expect(canSaveFvRate("9.2", 9.2, false)).toBe(false);
  });

  it("blocks saves while a mutation is pending", () => {
    expect(canSaveFvRate("5.5", 9.2, true)).toBe(false);
  });
});
