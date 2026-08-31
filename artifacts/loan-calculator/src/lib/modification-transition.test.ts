import { describe, expect, it } from "vitest";
import {
  buildFileSummary,
  buildTransitionJournalEntries,
  calculateBookedSchedule,
  hydrateLinkedAgreementPredecessors,
  type AgreementModificationAssessment,
  type BookedScheduleInput,
} from "./aspe-utils";
import { runLoanDiagnostics } from "./diagnostics";
import { buildFileWorkpapers, type WorkpaperLoanInput } from "./workpaper-export";

const assessment: AgreementModificationAssessment = {
  status: "confirmed",
  assessmentDate: "2025-07-01",
  confirmedAt: "2025-07-02T12:00:00Z",
  confirmedBy: "Reviewer",
  evidence: {
    changeSummary: "Rate and maturity changed",
    contractualChanges: [{
      term: "Rate",
      predecessorValue: "5%",
      successorValue: "6%",
      significance: "Prospective cash flows changed",
      sourceReference: "Amending agreement section 2",
    }],
    qualitativeFactors: [],
    facts: { creditorChanged: false, legalDischarge: false, relatedParty: false },
    quantitativeTest: {
      method: "PV at original EIR",
      originalEffectiveRate: 5,
      carryingAmount: 100000,
      originalRemainingCashFlows: [
        { date: "2026-07-01", amount: 105000, description: "Original maturity cash flow", sourceReference: "Original agreement" },
      ],
      modifiedCashFlows: [
        { date: "2025-07-01", amount: 1000, description: "Effective-date modified payment", sourceReference: "Amending agreement" },
        { date: "2026-07-01", amount: 107000, description: "Modified maturity cash flow", sourceReference: "Amending agreement" },
      ],
      sameDayPaymentTreatment: "include",
      creditorFees: 500,
      otherTransactionCosts: 1000,
      accruedInterest: 0,
      accruedInterestTreatment: "included_in_carrying_amount",
      presentValueOfOriginalRemainingCashFlows: 100000,
      presentValueOfModifiedCashFlows: 101904.76,
      differenceAmount: 1904.76,
      differencePercent: 1.90476,
      retainedFeesAndCosts: 1000,
      newFeesAndCosts: 500,
      settlementConsideration: 90000,
      recommendation: "account_as_modification",
    },
  },
  conclusion: {
    agreementChangeType: "modification",
    accountingTreatment: "continuation",
    rationale: "The original liability continues.",
  },
};

function loan(id: string, startDate: string, overrides: Partial<BookedScheduleInput> = {}): BookedScheduleInput & { id: string; name: string } {
  return {
    id,
    name: id,
    principal: 120000,
    interestRate: 5,
    amortizationYears: 10,
    termYears: 5,
    startDate,
    paymentFrequency: "monthly",
    ...overrides,
  };
}

describe("agreement transition accounting outputs", () => {
  it("cuts over once at the effective date", () => {
    const predecessor = loan("old", "2025-01-01");
    const successor = loan("new", "2025-07-01", {
      interestRate: 6,
      predecessorAgreement: predecessor,
      predecessorAgreementId: "old",
      modificationEffectiveDate: "2025-07-01",
      modificationAssessment: assessment,
    });
    const oldSchedule = calculateBookedSchedule(predecessor).schedule;
    const transition = calculateBookedSchedule(successor);

    expect(transition.schedule.filter((row) => row.date < new Date("2025-07-01")).length)
      .toBe(oldSchedule.filter((row) => row.date < new Date("2025-07-01")).length);
    expect(transition.schedule.filter((row) => row.date.getTime() === new Date("2025-07-01").getTime())).toHaveLength(1);
    expect(transition.schedule.filter((row) => row.date > new Date("2025-07-01")).length).toBe(1);
    expect(transition.evidenceMetadata?.transition).toMatchObject({
      predecessorAgreementId: "old",
      accountingTreatment: "continuation",
    });
    expect((transition.evidenceMetadata?.transition as { prospectiveEffectiveInterestBasis: number }).prospectiveEffectiveInterestBasis).toBe(98500);
    expect(transition.schedule.at(-1)?.contractualAnnualRate).not.toBe(6);
  });

  it("assigns an excluded same-day payment to the predecessor", () => {
    const predecessor = loan("old", "2025-01-01");
    const excludeAssessment: AgreementModificationAssessment = {
      ...assessment,
      evidence: {
        ...assessment.evidence,
        quantitativeTest: {
          ...assessment.evidence.quantitativeTest!,
          sameDayPaymentTreatment: "exclude",
        },
      },
    };
    const transition = calculateBookedSchedule(loan("new", "2025-07-01", {
      predecessorAgreement: predecessor,
      predecessorAgreementId: "old",
      modificationEffectiveDate: "2025-07-01",
      modificationAssessment: excludeAssessment,
    }));
    const effectiveRows = transition.schedule.filter((row) => row.date.getTime() === new Date("2025-07-01").getTime());
    expect(effectiveRows).toHaveLength(1);
    expect(transition.evidenceMetadata?.transition).toMatchObject({ effectiveDateOwner: "predecessor" });
  });

  it("falls back without throwing and diagnoses malformed legacy continuation evidence", () => {
    const malformedAssessment: AgreementModificationAssessment = {
      ...assessment,
      evidence: {
        ...assessment.evidence,
        quantitativeTest: {
          ...assessment.evidence.quantitativeTest!,
          modifiedCashFlows: [],
        },
      },
    };
    const predecessor = loan("legacy-old", "2025-01-01");
    const successor = loan("legacy-new", "2025-07-01", {
      predecessorAgreement: predecessor,
      predecessorAgreementId: predecessor.id,
      modificationEffectiveDate: "2025-07-01",
      modificationAssessment: malformedAssessment,
    });

    expect(() => calculateBookedSchedule(successor)).not.toThrow();
    const schedule = calculateBookedSchedule(successor);
    expect(schedule.evidenceMetadata?.transition).toMatchObject({
      prospectiveEirFallback: "date_cut_standalone_successor",
      assessmentCorrectionRequired: true,
    });
    expect((schedule.evidenceMetadata?.transition as { prospectiveEirWarning?: string }).prospectiveEirWarning)
      .toContain("could not be produced");

    const diagnostics = runLoanDiagnostics(
      { ...successor, isCapitalLease: false, modificationAssessment: malformedAssessment },
      { fiscalYearEnd: "2025-12-31" },
    );
    expect(diagnostics.findings).toContainEqual(expect.objectContaining({
      id: "prospective-eir-evidence-invalid",
      severity: "error",
    }));
  });

  it("suppresses the standalone predecessor in file totals and exports transition evidence", () => {
    const predecessor = loan("old", "2025-01-01");
    const successor = loan("new", "2025-07-01", {
      predecessorAgreementId: "old",
      modificationEffectiveDate: "2025-07-01",
      modificationAssessment: assessment,
    });
    const summary = buildFileSummary([predecessor, successor], "2025-12-31");
    expect(summary.loans.map((item) => item.id)).toEqual(["new"]);

    const workpapers = buildFileWorkpapers({
      clientName: "Client",
      fiscalYearEnd: "2025-12-31",
      loans: [predecessor, successor] as WorkpaperLoanInput[],
    });
    expect(workpapers.map((item) => item.loanName)).toEqual(["new"]);
    expect(workpapers[0].sections.some((section) => section.title === "Agreement Transition Assessment")).toBe(true);
    expect(workpapers[0].sections.some((section) => section.title === "Agreement Transition Journal Entries")).toBe(true);
  });

  it("hydrates a predecessor from a prior file into current-file summaries and workpapers", () => {
    const predecessor = {
      ...loan("prior-file-old", "2025-01-01"),
      fileId: "prior-file",
    };
    const successor = {
      ...loan("current-file-new", "2025-07-01", {
        predecessorAgreementId: predecessor.id,
        modificationEffectiveDate: "2025-07-01",
        modificationAssessment: assessment,
      }),
      fileId: "current-file",
    };
    const currentFileLoans = [successor];
    const priorFileLoans = [predecessor];
    const reportingLoans = hydrateLinkedAgreementPredecessors(currentFileLoans, priorFileLoans);

    expect(reportingLoans.map((item) => item.id)).toEqual([successor.id, predecessor.id]);
    expect(reportingLoans[0].predecessorAgreement?.fileId).toBe("prior-file");

    const summary = buildFileSummary(reportingLoans, "2025-12-31");
    expect(summary.loans.map((item) => item.id)).toEqual([successor.id]);
    expect(summary.loans[0].principalRepaidCurrentFY).toBeGreaterThan(0);

    const workpapers = buildFileWorkpapers({
      clientName: "Client",
      fiscalYearEnd: "2025-12-31",
      loans: reportingLoans as WorkpaperLoanInput[],
    });
    expect(workpapers.map((item) => item.loanName)).toEqual([successor.name]);
    expect(workpapers[0].sections.some((section) => section.title === "Agreement Transition Assessment")).toBe(true);
    expect(workpapers[0].sections.some((section) => section.title === "Agreement Transition Journal Entries")).toBe(true);
  });

  it("combines operating-lease history and successor activity without double counting", () => {
    const predecessor = {
      ...loan("old-op", "2025-01-01"),
      interestRate: 0,
      monthlyPayment: 100,
      termMonths: 12,
      tenantImprovementAllowance: 120,
      otherInducements: 0,
      isCapitalLease: false,
    };
    const leaseAssessment: AgreementModificationAssessment = {
      ...assessment,
      evidence: { ...assessment.evidence, quantitativeTest: null },
      conclusion: {
        ...assessment.conclusion,
        accountingTreatment: "new_lease",
        leaseTransition: {
          predecessorLeaseType: "operating",
          originalLeaseTerminated: true,
          replacementLeaseExecuted: true,
          terminationEvidenceReference: "Termination agreement",
          entryDate: "2025-07-01",
          debitAccount: "Deferred rent liability",
          creditAccount: "Deferred rent asset",
          amount: 500,
          entryEvidenceReference: "JE-7",
          predecessorDeferredRentAsset: 500,
          predecessorDeferredRentLiability: 100,
          predecessorAssetCost: null,
          predecessorAccumulatedDepreciation: null,
          successorInitialAmount: 0,
        },
      },
    };
    const successor = {
      ...loan("new-op", "2025-07-01"),
      interestRate: 0,
      monthlyPayment: 200,
      termMonths: 12,
      tenantImprovementAllowance: 240,
      otherInducements: 0,
      isCapitalLease: false,
      predecessorAgreementId: "old-op",
      modificationEffectiveDate: "2025-07-01",
      modificationAssessment: leaseAssessment,
    };
    const file = buildFileSummary([predecessor, successor], "2025-12-31");
    expect(file.operatingLeases).toHaveLength(1);
    const combined = file.operatingLeases[0];
    expect(combined.yearlyCash.find((row) => row.fiscalYear === 2025)?.amount).toBe(1700);
    expect(combined.yearlyStraightLine.find((row) => row.fiscalYear === 2025)?.amount).toBe(1530);
    expect(combined.totalCommitment).toBe(2900);
    expect(combined.totalInducements).toBe(290);
    expect(combined.deferredRentAtYearEnd).toBe(100);
    expect(file.totalOperatingLeaseCash).toBe(1700);
    expect(file.totalStraightLineRentExpense).toBe(1530);
  });

  it("models continuation fees, extinguishment gain, and lease derecognition/commencement separately", () => {
    const continuation = buildTransitionJournalEntries({
      effectiveDate: "2025-07-01",
      assessment,
      predecessorKind: "loan",
      successorKind: "loan",
      predecessorCarryingAmount: 100000,
      successorInitialAmount: 100000,
    });
    expect(continuation[0].memo).toContain("98500.00");

    const extinguishmentAssessment = {
      ...assessment,
      conclusion: { ...assessment.conclusion, accountingTreatment: "extinguishment" as const },
    };
    const extinguishment = buildTransitionJournalEntries({
      effectiveDate: "2025-07-01",
      assessment: extinguishmentAssessment,
      predecessorKind: "loan",
      successorKind: "capital_lease",
      predecessorCarryingAmount: 100000,
      successorInitialAmount: 90000,
    });
    expect(extinguishment.map((entry) => entry.kind)).toEqual(["debt_extinguishment", "lease_commencement"]);
    expect(extinguishment[0].lines.find((line) => line.account === "Gain on debt extinguishment")?.credit).toBe(10000);

    const lease = buildTransitionJournalEntries({
      effectiveDate: "2025-07-01",
      assessment,
      predecessorKind: "capital_lease",
      successorKind: "capital_lease",
      predecessorCarryingAmount: 70000,
      successorInitialAmount: 80000,
      capitalLeaseAssetCost: 100000,
      capitalLeaseAccumulatedDepreciation: 25000,
    });
    expect(lease.map((entry) => entry.kind)).toEqual(["capital_lease_derecognition", "lease_commencement"]);
  });

  it("recognizes successor debt separately after an extinguishment", () => {
    const extinguishmentAssessment: AgreementModificationAssessment = {
      ...assessment,
      conclusion: { ...assessment.conclusion, accountingTreatment: "extinguishment" },
    };
    const entries = buildTransitionJournalEntries({
      effectiveDate: "2025-07-01",
      assessment: extinguishmentAssessment,
      predecessorKind: "loan",
      successorKind: "loan",
      predecessorCarryingAmount: 100000,
      successorInitialAmount: 107000,
    });
    expect(entries.map((entry) => entry.kind)).toEqual(["debt_extinguishment", "debt_recognition"]);
  });

  it("routes new_lease exclusively through ASPE 3065 termination and commencement", () => {
    const newLeaseAssessment: AgreementModificationAssessment = {
      ...assessment,
      conclusion: {
        ...assessment.conclusion,
        accountingTreatment: "new_lease",
        leaseTransition: {
          predecessorLeaseType: "operating",
          originalLeaseTerminated: true,
          replacementLeaseExecuted: true,
          terminationEvidenceReference: "Termination agreement",
          entryDate: "2025-07-01",
          debitAccount: "Deferred rent liability",
          creditAccount: "Deferred rent asset",
          amount: 500,
          entryEvidenceReference: "JE-7",
          predecessorDeferredRentAsset: 500,
          predecessorDeferredRentLiability: 100,
          predecessorAssetCost: 100000,
          predecessorAccumulatedDepreciation: 25000,
          successorInitialAmount: 80000,
        },
      },
    };
    const capital = buildTransitionJournalEntries({
      effectiveDate: "2025-07-01",
      assessment: newLeaseAssessment,
      predecessorKind: "capital_lease",
      successorKind: "capital_lease",
      predecessorCarryingAmount: 70000,
      successorInitialAmount: 80000,
      capitalLeaseAssetCost: 100000,
      capitalLeaseAccumulatedDepreciation: 25000,
    });
    expect(capital.map((entry) => entry.kind)).toEqual(["capital_lease_derecognition", "lease_commencement"]);
    expect(capital.some((entry) => entry.kind === "debt_modification" || entry.kind === "debt_extinguishment")).toBe(false);

    const operating = buildTransitionJournalEntries({
      effectiveDate: "2025-07-01",
      assessment: newLeaseAssessment,
      predecessorKind: "operating_lease",
      successorKind: "operating_lease",
      predecessorCarryingAmount: 0,
      successorInitialAmount: 0,
      operatingDeferredRentAsset: 999,
    });
    expect(operating.map((entry) => entry.kind)).toEqual(["operating_lease_termination", "operating_lease_commencement"]);
    expect(operating[0].lines.find((line) => line.account === "Deferred rent asset")?.credit).toBe(500);

    // A malformed debt predecessor still cannot create a debt accounting entry.
    const malformed = buildTransitionJournalEntries({
      effectiveDate: "2025-07-01",
      assessment: newLeaseAssessment,
      predecessorKind: "loan",
      successorKind: "operating_lease",
      predecessorCarryingAmount: 100000,
      successorInitialAmount: 0,
    });
    expect(malformed.map((entry) => entry.kind)).toEqual(["operating_lease_commencement"]);
  });

  it("flags partially linked and unconfirmed assessments", () => {
    const base = {
      ...loan("new", "2025-01-01"),
      isCapitalLease: false,
      paymentFrequency: "monthly",
      predecessorAgreementId: "old",
    };
    const partial = runLoanDiagnostics(base, { fiscalYearEnd: "2025-12-31" });
    expect(partial.findings.some((finding) => finding.id === "modification-assessment-unresolved")).toBe(true);

    const unconfirmed = runLoanDiagnostics({
      ...base,
      modificationEffectiveDate: "2025-07-01",
      modificationAssessment: { status: "draft", conclusion: { accountingTreatment: "continuation", rationale: "" } },
    }, { fiscalYearEnd: "2025-12-31" });
    expect(unconfirmed.findings.some((finding) => finding.id === "modification-assessment-unconfirmed")).toBe(true);
  });
});