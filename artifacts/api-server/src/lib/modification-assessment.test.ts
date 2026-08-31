import { describe, expect, it } from "vitest";
import { GetLoanResponse, UpdateLoanBody } from "@workspace/api-zod";
import {
  agreementKind,
  validateAccountingTreatmentForAgreementKind,
  validateConfirmedModificationAssessment,
  validatePredecessorChain,
  validatePredecessorRelationship,
  validateStructuredAssessmentForAgreement,
} from "./modification-assessment";

const confirmed = {
  status: "confirmed",
  assessmentDate: "2025-01-01",
  confirmedAt: "2025-01-02T12:00:00.000Z",
  confirmedBy: "A. Reviewer",
  evidence: {
    changeSummary: "Term and rate renewed",
    contractualChanges: [{
      term: "Interest rate",
      predecessorValue: "5%",
      successorValue: "6%",
      significance: "Cash flows changed",
      sourceReference: "Renewal letter, page 1",
    }],
    qualitativeFactors: [],
  },
  conclusion: {
    agreementChangeType: "renewal",
    accountingTreatment: "continuation",
    rationale: "The changes are not substantial.",
  },
};

describe("modification assessment validation", () => {
  it("accepts complete confirmed evidence and conclusion", () => {
    expect(validateConfirmedModificationAssessment(confirmed)).toBeNull();
  });

  it("rejects unconfirmed and incomplete assessments", () => {
    expect(validateConfirmedModificationAssessment({ ...confirmed, status: "draft" }))
      .toContain("confirmed");
    expect(validateConfirmedModificationAssessment({
      ...confirmed,
      evidence: { ...confirmed.evidence, contractualChanges: [] },
    })).toContain("at least one");
  });

  it("distinguishes loans from both capital and operating leases", () => {
    expect(agreementKind({ isCapitalLease: false, interestRate: "5", monthlyPayment: null, termMonths: null }))
      .toBe("loan");
    expect(agreementKind({ isCapitalLease: true, interestRate: "5", monthlyPayment: "10", termMonths: 12 }))
      .toBe("lease");
    expect(agreementKind({ isCapitalLease: false, interestRate: "0", monthlyPayment: "10", termMonths: 12 }))
      .toBe("lease");
  });

  it("rejects self, cross-client, incompatible, and cyclic predecessors", () => {
    const valid = {
      targetId: "new",
      targetClientId: "client-a",
      targetKind: "loan" as const,
      predecessorId: "old",
      predecessorClientId: "client-a",
      predecessorKind: "loan" as const,
    };
    expect(validatePredecessorRelationship(valid)).toBeNull();
    expect(validatePredecessorRelationship({ ...valid, predecessorId: "new" })).toContain("own predecessor");
    expect(validatePredecessorRelationship({ ...valid, predecessorClientId: "client-b" })).toContain("same client");
    expect(validatePredecessorRelationship({ ...valid, predecessorKind: "lease" })).toContain("loan-versus-lease");
    expect(validatePredecessorChain("new", ["old", "new"])).toContain("create a cycle");
    expect(validatePredecessorChain("new", ["old", "older", "old"])).toContain("already contains a cycle");
  });

  it("requires new_lease for lease predecessors only", () => {
    expect(validateAccountingTreatmentForAgreementKind(confirmed, "loan")).toBeNull();
    expect(validateAccountingTreatmentForAgreementKind(confirmed, "lease")).toContain("require");
    const newLease = {
      ...confirmed,
      conclusion: { ...confirmed.conclusion, accountingTreatment: "new_lease" },
    };
    expect(validateAccountingTreatmentForAgreementKind(newLease, "lease")).toBeNull();
    expect(validateAccountingTreatmentForAgreementKind(newLease, "loan")).toContain("only permitted");
  });

  it("recomputes loan evidence and blocks date or numeric bypasses", () => {
    const assessment = {
      ...confirmed,
      evidence: {
        ...confirmed.evidence,
        facts: {
          creditorChanged: false,
          legalDischarge: false,
          relatedParty: false,
        },
        quantitativeTest: {
          method: "ASPE 3856 dated 10% test",
          originalEffectiveRate: 0,
          carryingAmount: 100,
          originalRemainingCashFlows: [{ date: "2025-02-01", amount: 100, description: "Original payment", sourceReference: "Original contract" }],
          modifiedCashFlows: [{ date: "2025-02-01", amount: 95, description: "Modified payment", sourceReference: "Modification agreement" }],
          sameDayPaymentTreatment: "include",
          creditorFees: 0,
          otherTransactionCosts: 0,
          accruedInterest: 0,
          accruedInterestTreatment: "included_in_carrying_amount",
          presentValueOfOriginalRemainingCashFlows: 100,
          presentValueOfModifiedCashFlows: 95,
          differenceAmount: -5,
          differencePercent: 5,
          retainedFeesAndCosts: 0,
          retainedFeesAndCostsSourceReference: "Prior fee continuity schedule",
          newFeesAndCosts: 0,
          recommendation: "account_as_modification",
        },
      },
    };
    const input = {
      assessment,
      kind: "loan" as const,
      predecessorStartDate: "2024-01-01",
      predecessorLeaseType: "capital" as const,
      successorLeaseType: "operating" as const,
      predecessorOriginalEffectiveRate: 0,
      modificationEffectiveDate: "2025-01-01",
      successorStartDate: "2025-01-01",
    };
    expect(validateStructuredAssessmentForAgreement(input)).toBeNull();
    expect(validateStructuredAssessmentForAgreement({
      ...input,
      assessment: { ...assessment, assessmentDate: "2025-01-02" },
    })).toContain("assessmentDate");
    const staleDerived = {
      ...input,
      assessment: {
        ...assessment,
        evidence: {
          ...assessment.evidence,
          quantitativeTest: { ...assessment.evidence.quantitativeTest, differencePercent: 4.99 },
        },
      },
    };
    expect(validateStructuredAssessmentForAgreement(staleDerived)).toBeNull();
    expect(staleDerived.assessment.evidence.quantitativeTest.differencePercent).toBe(5);
    expect(validateStructuredAssessmentForAgreement({
      ...input,
      assessment: {
        ...assessment,
        evidence: {
          ...assessment.evidence,
          quantitativeTest: { ...assessment.evidence.quantitativeTest, originalEffectiveRate: 1 },
        },
      },
    })).toContain("originalEffectiveRate");
    expect(validateStructuredAssessmentForAgreement({
      ...input,
      assessment: {
        ...assessment,
        evidence: {
          ...assessment.evidence,
          quantitativeTest: {
            ...assessment.evidence.quantitativeTest,
            retainedFeesAndCostsSourceReference: " ",
          },
        },
      },
    })).toContain("SourceReference");
    expect(validateStructuredAssessmentForAgreement({
      ...input,
      assessment: {
        ...assessment,
        evidence: {
          ...assessment.evidence,
          quantitativeTest: {
            ...assessment.evidence.quantitativeTest,
            creditorFees: 2,
            otherTransactionCosts: 3,
            newFeesAndCosts: 4,
          },
        },
      },
    })).toContain("creditorFees plus otherTransactionCosts");
  });

  it("preserves accountant loan conclusions while verifying legal recommendations", () => {
    const base = {
      ...confirmed,
      evidence: {
        ...confirmed.evidence,
        facts: { creditorChanged: false, legalDischarge: false, relatedParty: false },
        quantitativeTest: {
          method: "dated test", originalEffectiveRate: 0, carryingAmount: 100,
          originalRemainingCashFlows: [{ date: "2025-02-01", amount: 100, description: "old", sourceReference: "old agreement" }],
          modifiedCashFlows: [{ date: "2025-02-01", amount: 95, description: "new", sourceReference: "new agreement" }],
          sameDayPaymentTreatment: "include", creditorFees: 0, otherTransactionCosts: 0,
          accruedInterest: 0, accruedInterestTreatment: "included_in_carrying_amount",
          presentValueOfOriginalRemainingCashFlows: 100, presentValueOfModifiedCashFlows: 95,
          differenceAmount: -5, differencePercent: 5, retainedFeesAndCosts: 0,
          retainedFeesAndCostsSourceReference: "Prior fee continuity schedule", newFeesAndCosts: 0,
          settlementConsideration: 25,
          recommendation: "account_as_modification",
        },
      },
    };
    const input = {
      assessment: { ...base, conclusion: { ...base.conclusion, accountingTreatment: "extinguishment" } },
      kind: "loan" as const, predecessorStartDate: "2024-01-01", predecessorLeaseType: "capital" as const,
      successorLeaseType: "operating" as const,
      predecessorOriginalEffectiveRate: 0, modificationEffectiveDate: "2025-01-01", successorStartDate: "2025-01-01",
    };
    expect(validateStructuredAssessmentForAgreement(input)).toBeNull();
    const discharge = {
      ...base,
      evidence: {
        ...base.evidence,
        facts: { ...base.evidence.facts, legalDischarge: true, legalDischargeEvidence: "Release document" },
        quantitativeTest: { ...base.evidence.quantitativeTest, recommendation: "derecognize_original" },
      },
      conclusion: { ...base.conclusion, accountingTreatment: "continuation" },
    };
    expect(validateStructuredAssessmentForAgreement({ ...input, assessment: discharge })).toBeNull();
    const creditorChange = {
      ...base,
      evidence: {
        ...base.evidence,
        facts: { ...base.evidence.facts, creditorChanged: true, creditorChangedEvidence: "Assignment agreement" },
        quantitativeTest: { ...base.evidence.quantitativeTest, recommendation: "derecognize_original" },
      },
      conclusion: { ...base.conclusion, accountingTreatment: "continuation" },
    };
    expect(validateStructuredAssessmentForAgreement({ ...input, assessment: creditorChange })).toBeNull();
    const noSettlement = {
      ...base,
      evidence: {
        ...base.evidence,
        quantitativeTest: { ...base.evidence.quantitativeTest, settlementConsideration: 0 },
      },
      conclusion: { ...base.conclusion, accountingTreatment: "extinguishment" },
    };
    expect(validateStructuredAssessmentForAgreement({ ...input, assessment: noSettlement }))
      .toContain("settlementConsideration");
  });

  it("requires applicable finite predecessor and successor lease balances", () => {
    const transition = {
      predecessorLeaseType: "operating",
      originalLeaseTerminated: true,
      replacementLeaseExecuted: true,
      terminationEvidenceReference: "Termination",
      entryDate: "2025-01-01",
      debitAccount: "Rent expense",
      creditAccount: "Lease payable",
      amount: 100,
      entryEvidenceReference: "Entry 1",
      predecessorDeferredRentAsset: null,
      predecessorDeferredRentLiability: null,
      predecessorAssetCost: null,
      predecessorAccumulatedDepreciation: null,
      successorInitialAmount: 0,
    };
    const lease = {
      ...confirmed,
      evidence: {
        ...confirmed.evidence,
        facts: { creditorChanged: false, legalDischarge: false, relatedParty: false },
      },
      conclusion: {
        ...confirmed.conclusion,
        accountingTreatment: "new_lease",
        leaseTransition: transition,
      },
    };
    const input = {
      assessment: lease, kind: "lease" as const, predecessorStartDate: "2024-01-01",
      predecessorLeaseType: "operating" as const, successorLeaseType: "operating" as const,
      predecessorOriginalEffectiveRate: 0, modificationEffectiveDate: "2025-01-01",
      successorStartDate: "2025-01-01",
    };
    expect(validateStructuredAssessmentForAgreement(input)).toContain("DeferredRent");
    const operating = {
      ...lease,
      conclusion: {
        ...lease.conclusion,
        leaseTransition: {
          ...transition,
          predecessorDeferredRentAsset: 0,
          predecessorDeferredRentLiability: 0,
        },
      },
    };
    expect(validateStructuredAssessmentForAgreement({ ...input, assessment: operating })).toBeNull();
    const capital = {
      ...operating,
      conclusion: {
        ...operating.conclusion,
        leaseTransition: {
          ...operating.conclusion.leaseTransition,
          predecessorLeaseType: "capital",
          predecessorAssetCost: 100,
          predecessorAccumulatedDepreciation: 101,
          successorInitialAmount: 0,
        },
      },
    };
    const capitalInput = {
      ...input,
      assessment: capital,
      predecessorLeaseType: "capital" as const,
      successorLeaseType: "capital" as const,
    };
    expect(validateStructuredAssessmentForAgreement(capitalInput)).toContain("predecessorAssetCost");
    const noSuccessorAmount = {
      ...capital,
      conclusion: {
        ...capital.conclusion,
        leaseTransition: {
          ...capital.conclusion.leaseTransition,
          predecessorAccumulatedDepreciation: 40,
        },
      },
    };
    expect(validateStructuredAssessmentForAgreement({
      ...capitalInput,
      assessment: noSuccessorAmount,
    })).toContain("successorInitialAmount");
    const validCapital = {
      ...capital,
      conclusion: {
        ...capital.conclusion,
        leaseTransition: {
          ...capital.conclusion.leaseTransition,
          predecessorAccumulatedDepreciation: 40,
          successorInitialAmount: 60,
        },
      },
    };
    expect(validateStructuredAssessmentForAgreement({ ...capitalInput, assessment: validCapital })).toBeNull();
  });

  it("rejects invalid modification dates at the API boundary", () => {
    expect(UpdateLoanBody.safeParse({
      modificationEffectiveDate: "not-a-calendar-date",
    }).success).toBe(false);
  });

  it("rejects incomplete continuation flows after canonicalizing stale derived results", () => {
    const quantitativeTest = {
      method: "ASPE 3856 dated 10% test; Actual/365; original effective rate 4.2%",
      originalEffectiveRate: 4.2,
      carryingAmount: 95_000,
      originalRemainingCashFlows: [{
        date: "2025-07-01",
        amount: 1_823.66,
        description: "Original remaining payment",
        sourceReference: "Original agreement",
      }],
      modifiedCashFlows: [{
        date: "2025-07-01",
        amount: 1_805,
        description: "Modified payment",
        sourceReference: "Modification agreement",
      }],
      sameDayPaymentTreatment: "include",
      creditorFees: 150,
      otherTransactionCosts: 50,
      accruedInterest: 0,
      accruedInterestTreatment: "included_in_carrying_amount",
      predecessorAmount: 0,
      successorAmount: 0,
      presentValueOfOriginalRemainingCashFlows: 0,
      presentValueOfModifiedCashFlows: 0,
      differenceAmount: 0,
      differencePercent: 0,
      retainedFeesAndCosts: 0,
      retainedFeesAndCostsSourceReference: "Prior fee continuity schedule",
      newFeesAndCosts: 200,
      recommendation: "derecognize_original",
    };
    const assessment = {
      ...confirmed,
      assessmentDate: "2025-06-01",
      evidence: {
        ...confirmed.evidence,
        facts: { creditorChanged: false, legalDischarge: false, relatedParty: false },
        quantitativeTest,
      },
    };
    const uiPayload = {
      predecessorAgreementId: "predecessor-id",
      modificationEffectiveDate: "2025-06-01",
      modificationAssessment: assessment,
    };
    expect(UpdateLoanBody.safeParse(uiPayload).success).toBe(true);
    expect(validateStructuredAssessmentForAgreement({
      assessment,
      kind: "loan",
      predecessorStartDate: "2024-06-01",
      predecessorLeaseType: "capital",
      successorLeaseType: "operating",
      predecessorOriginalEffectiveRate: 4.2,
      modificationEffectiveDate: "2025-06-01",
      successorStartDate: "2025-06-01",
    })).toContain("cannot support the effective-interest basis");
    expect(quantitativeTest.presentValueOfOriginalRemainingCashFlows).toBeGreaterThan(0);
    expect(quantitativeTest.presentValueOfModifiedCashFlows).toBeGreaterThan(0);
    expect(quantitativeTest.recommendation).toBe("account_as_modification");
  });

  it("accepts continuation evidence with a solvable maturity flow", () => {
    const assessment = {
      ...confirmed,
      assessmentDate: "2025-06-01",
      evidence: {
        ...confirmed.evidence,
        facts: { creditorChanged: false, legalDischarge: false, relatedParty: false },
        quantitativeTest: {
          method: "ASPE 3856 dated 10% test",
          originalEffectiveRate: 4.2,
          carryingAmount: 95_000,
          originalRemainingCashFlows: [{
            date: "2026-06-01",
            amount: 100_000,
            description: "Original maturity payment",
            sourceReference: "Original agreement",
          }],
          modifiedCashFlows: [{
            date: "2026-06-01",
            amount: 98_000,
            description: "Modified maturity payment",
            sourceReference: "Modification agreement",
          }],
          sameDayPaymentTreatment: "include",
          creditorFees: 150,
          otherTransactionCosts: 50,
          accruedInterest: 0,
          accruedInterestTreatment: "included_in_carrying_amount",
          predecessorAmount: 0,
          successorAmount: 0,
          presentValueOfOriginalRemainingCashFlows: 0,
          presentValueOfModifiedCashFlows: 0,
          differenceAmount: 0,
          differencePercent: 0,
          retainedFeesAndCosts: 0,
          retainedFeesAndCostsSourceReference: "Prior fee continuity schedule",
          newFeesAndCosts: 200,
          recommendation: "derecognize_original",
        },
      },
    };
    const uiPayload = {
      predecessorAgreementId: "predecessor-id",
      modificationEffectiveDate: "2025-06-01",
      modificationAssessment: assessment,
    };
    expect(UpdateLoanBody.safeParse(uiPayload).success).toBe(true);
    expect(validateStructuredAssessmentForAgreement({
      assessment,
      kind: "loan",
      predecessorStartDate: "2024-06-01",
      predecessorLeaseType: "capital",
      successorLeaseType: "operating",
      predecessorOriginalEffectiveRate: 4.2,
      modificationEffectiveDate: "2025-06-01",
      successorStartDate: "2025-06-01",
    })).toBeNull();
    const response = GetLoanResponse
      .pick({ modificationAssessment: true })
      .strict()
      .parse({ modificationAssessment: assessment });
    expect(response.modificationAssessment?.evidence.quantitativeTest?.presentValueOfOriginalRemainingCashFlows)
      .toBeGreaterThan(0);
    expect(response.modificationAssessment?.evidence.quantitativeTest?.presentValueOfModifiedCashFlows)
      .toBeGreaterThan(0);
  });
});