import { describe, expect, it } from "vitest";
import type { File, FvDecisionConfirmation, Loan } from "@workspace/db";
import {
  contextFor,
  deriveFvReviewStatus,
  confirmedFvProjection,
  isDirectFvProjectionWrite,
  validateFvConfirmation,
} from "./fv-decisions";

const loan = {
  id: "loan-1",
  fileId: "file-1",
  interestRate: "0.00",
  rateType: "fixed",
  paymentTiming: "end",
  currentRevisionId: "revision-1",
  currentRevisionHash: "contract-1",
  calculationVersion: "1",
  activeEventSetId: "events-1",
  activeEventSetVersion: 1,
  activeEventSetHash: "event-hash-1",
  initialFvRateAssumption: null,
  modificationAssessment: null,
  fvDecision: "use_fv",
  fvRate: "5.250000",
  fvDecisionNote: null,
} as Loan;
const file = {
  id: "file-1",
  fiscalYearEnd: "2025-12-31",
  trivialThreshold: "100.00",
  materiality: "1000.00",
} as File;

const confirmation = {
  id: "confirmation-1",
  loanId: "loan-1",
  version: 1,
  treatment: "use_fv",
  marketEffectiveRate: "5.250000",
  rationaleNote: null,
  contractFingerprint: "contract-1",
  eventSetFingerprint: "event-hash-1",
  reportingContextFingerprint: contextFor(loan, file).reportingFingerprint,
  modificationFingerprint: null,
  evidence: {
    termRevision: { id: "revision-1", hash: "contract-1" },
    eventSet: { id: "events-1", version: 1, hash: "event-hash-1" },
  },
} as FvDecisionConfirmation;

describe("FV decision evidence", () => {
  it.each(["trivial", "immaterial"] as const)(
    "requires rationale for %s",
    (treatment) => {
      expect(() => validateFvConfirmation(loan, {
        expectedVersion: 0,
        treatment,
        confirmedBy: "Accountant",
      })).toThrow("rationaleNote");
      expect(() => validateFvConfirmation(loan, {
        expectedVersion: 0,
        treatment,
        rationaleNote: "Documented conclusion",
        confirmedBy: "Accountant",
      })).not.toThrow();
    },
  );

  it("allows an explicit use_fv decision for a zero-percent contract", () => {
    expect(() => validateFvConfirmation(loan, {
      expectedVersion: 0,
      treatment: "use_fv",
      marketEffectiveRate: 5.25,
      confirmedBy: "Accountant",
    })).not.toThrow();
  });

  it("rejects invalid use_fv rates", () => {
    for (const marketEffectiveRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateFvConfirmation(loan, {
        expectedVersion: 0,
        treatment: "use_fv",
        marketEffectiveRate,
        confirmedBy: "Accountant",
      })).toThrow("greater than zero");
    }
  });

  it("requires approved frozen prime evidence without mutating it", () => {
    const assumption = { approved: true, recognitionDate: "2025-01-01", prime: 5 };
    const primeLoan = { ...loan, rateType: "prime_linked", initialFvRateAssumption: assumption } as Loan;
    validateFvConfirmation(primeLoan, {
      expectedVersion: 0,
      treatment: "use_fv",
      marketEffectiveRate: 7,
      confirmedBy: "Accountant",
    });
    expect(primeLoan.initialFvRateAssumption).toEqual(assumption);
    expect(() => validateFvConfirmation(
      { ...primeLoan, initialFvRateAssumption: { approved: false } } as Loan,
      { expectedVersion: 0, treatment: "use_fv", marketEffectiveRate: 7, confirmedBy: "A" },
    )).toThrow("approved frozen");
  });

  it("reports incomplete when a rate is saved without treatment", () => {
    const result = deriveFvReviewStatus(
      contextFor({ ...loan, fvDecision: null, fvRate: "5.00" } as Loan, file),
      null,
    );
    expect(result).toMatchObject({
      status: "incomplete",
      reviewRequired: true,
      missingRequirements: ["treatment"],
    });
  });

  it("reports a matching persisted confirmation as current", () => {
    expect(deriveFvReviewStatus(contextFor(loan, file), confirmation)).toMatchObject({
      status: "current",
      reviewRequired: false,
    });
  });

  it("marks inherited source-context evidence stale until this period is confirmed", () => {
    const inherited = {
      ...confirmation,
      id: "inherited-confirmation",
      sourceConfirmationId: "source-confirmation",
      inheritedFromLoanId: "source-loan",
      sourceFileId: "source-file",
      // The evidence snapshot remains the historical source snapshot rather
      // than being rewritten to make it appear target-period current.
      evidence: {
        ...confirmation.evidence,
        reportingContext: { fileId: "source-file", fiscalYearEnd: "2025-12-31" },
      },
    } as FvDecisionConfirmation;
    expect(deriveFvReviewStatus(contextFor(loan, file), inherited)).toMatchObject({
      status: "stale",
      reviewRequired: true,
      staleReasons: ["inherited_historical_evidence"],
    });
    expect(inherited.evidence.reportingContext).toEqual({
      fileId: "source-file",
      fiscalYearEnd: "2025-12-31",
    });
  });

  it("makes the confirmation the sole source of compatibility scalars", () => {
    expect(confirmedFvProjection({
      treatment: "use_fv",
      marketEffectiveRate: "5.250000",
      rationaleNote: null,
    })).toEqual({
      fvDecision: "use_fv",
      fvRate: "5.250000",
      fvDecisionNote: null,
    });
    expect(confirmedFvProjection({
      treatment: "trivial",
      marketEffectiveRate: "5.250000",
      rationaleNote: "Below threshold",
    })).toEqual({
      fvDecision: "trivial",
      fvRate: null,
      fvDecisionNote: "Below threshold",
    });
  });

  it("identifies direct PATCH projection writes for rejection", () => {
    expect(isDirectFvProjectionWrite({ fvDecision: "use_fv" })).toBe(true);
    expect(isDirectFvProjectionWrite({ fvRate: 5 })).toBe(true);
    expect(isDirectFvProjectionWrite({ fvDecisionNote: "note" })).toBe(true);
    expect(isDirectFvProjectionWrite({ paymentTiming: "beginning" })).toBe(false);
  });

  it("marks a changed compatibility projection as stale/tampered", () => {
    const result = deriveFvReviewStatus(
      contextFor({ ...loan, fvDecision: "trivial", fvRate: null } as Loan, file),
      confirmation,
    );
    expect(result).toMatchObject({
      status: "stale",
      reviewRequired: true,
      staleReasons: ["compatibility_projection_mismatch"],
    });
  });

  it.each([
    ["contract terms", { loan: { currentRevisionHash: "contract-2" } }, "contract_terms_changed"],
    ["event/rate history", { loan: { activeEventSetHash: "event-hash-2" } }, "event_or_rate_history_changed"],
    ["reporting context", { file: { materiality: "2000.00" } }, "reporting_context_changed"],
    ["modification evidence", { loan: { modificationAssessment: { conclusion: { accountingTreatment: "continuation" } } } }, "modification_assessment_changed"],
  ])("makes the review stale after %s changes", (_label, changes, reason) => {
    const typedChanges = changes as { loan?: Partial<Loan>; file?: Partial<File> };
    const changedLoan = { ...loan, ...typedChanges.loan } as Loan;
    const changedFile = { ...file, ...typedChanges.file } as File;
    expect(deriveFvReviewStatus(contextFor(changedLoan, changedFile), confirmation)).toMatchObject({
      status: "stale",
      reviewRequired: true,
      staleReasons: [reason],
    });
    expect(changedLoan.fvDecision).toBe(loan.fvDecision);
    expect(changedLoan.fvRate).toBe(loan.fvRate);
    expect(changedLoan.fvDecisionNote).toBe(loan.fvDecisionNote);
    expect(confirmation.version).toBe(1);
  });

  it("uses deterministic conservative review for ordinary prime resets", () => {
    const resetLoan = {
      ...loan,
      rateType: "prime_linked",
      activeEventSetVersion: 2,
      activeEventSetHash: "ordinary-reset-successor",
      initialFvRateAssumption: { approved: true, prime: 5 },
    } as Loan;
    const result = deriveFvReviewStatus(contextFor(resetLoan, file), confirmation);
    expect(result.staleReasons).toContain("event_or_rate_history_changed");
    expect(resetLoan.initialFvRateAssumption).toEqual({ approved: true, prime: 5 });
  });
});