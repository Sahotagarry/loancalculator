import {
  assessAspe3856Modification,
  calculateProspectiveModificationSchedule,
} from "@workspace/amortization";

type AgreementKindInput = {
  isCapitalLease: boolean;
  interestRate: string | number;
  monthlyPayment: string | number | null;
  termMonths: number | null;
};

export const agreementKind = (loan: AgreementKindInput): "loan" | "lease" =>
  loan.isCapitalLease ||
  (!loan.isCapitalLease &&
    Number(loan.interestRate) === 0 &&
    loan.monthlyPayment != null &&
    loan.termMonths != null)
    ? "lease"
    : "loan";

export const validatePredecessorRelationship = (input: {
  targetId?: string;
  targetClientId: string;
  targetKind: "loan" | "lease";
  predecessorId: string;
  predecessorClientId: string;
  predecessorKind: "loan" | "lease";
}): string | null => {
  if (input.targetId && input.predecessorId === input.targetId) {
    return "An agreement cannot be its own predecessor";
  }
  if (input.predecessorClientId !== input.targetClientId) {
    return "Predecessor agreement must belong to the same client";
  }
  if (input.predecessorKind !== input.targetKind) {
    return "Predecessor agreement must be the same loan-versus-lease kind";
  }
  return null;
};

export const validatePredecessorChain = (
  targetId: string | undefined,
  chain: string[],
): string | null => {
  const visited = new Set<string>();
  for (const id of chain) {
    if (targetId && id === targetId) {
      return "Predecessor agreement link would create a cycle";
    }
    if (visited.has(id)) {
      return "Predecessor agreement chain already contains a cycle";
    }
    visited.add(id);
  }
  return null;
};

export const validateAccountingTreatmentForAgreementKind = (
  assessment: unknown,
  kind: "loan" | "lease",
): string | null => {
  const treatment =
    assessment &&
    typeof assessment === "object" &&
    !Array.isArray(assessment)
      ? (assessment as { conclusion?: { accountingTreatment?: unknown } })
          .conclusion?.accountingTreatment
      : undefined;
  if (kind === "lease" && treatment !== "new_lease") {
    return "Lease predecessor relationships require modificationAssessment.conclusion.accountingTreatment to be new_lease";
  }
  if (kind === "loan" && treatment === "new_lease") {
    return "new_lease accounting treatment is only permitted for lease predecessor relationships";
  }
  return null;
};

const sameNumber = (actual: number, supplied: unknown): boolean =>
  typeof supplied === "number" &&
  Number.isFinite(supplied) &&
  Math.abs(actual - supplied) <= 0.000001 * Math.max(1, Math.abs(actual));

export const validateStructuredAssessmentForAgreement = (input: {
  assessment: unknown;
  kind: "loan" | "lease";
  predecessorStartDate: string;
  predecessorLeaseType: "operating" | "capital";
  successorLeaseType: "operating" | "capital";
  predecessorOriginalEffectiveRate: number;
  modificationEffectiveDate: string;
  successorStartDate: string;
}): string | null => {
  const effective = new Date(`${input.modificationEffectiveDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(effective.getTime()) ||
    effective.toISOString().slice(0, 10) !== input.modificationEffectiveDate
  ) return "modificationEffectiveDate must be a valid calendar date";
  if (input.modificationEffectiveDate < input.predecessorStartDate) {
    return "modificationEffectiveDate cannot precede the predecessor startDate";
  }
  if (input.modificationEffectiveDate !== input.successorStartDate) {
    return "modificationEffectiveDate must equal the successor startDate";
  }
  const assessment = input.assessment as Record<string, any>;
  if (assessment.assessmentDate !== input.modificationEffectiveDate) {
    return "modificationAssessment.assessmentDate must equal modificationEffectiveDate";
  }
  const facts = assessment.evidence?.facts;
  if (!facts || typeof facts !== "object") return "Assessment evidence requires structured facts";
  for (const [flag, evidence] of [
    ["creditorChanged", "creditorChangedEvidence"],
    ["legalDischarge", "legalDischargeEvidence"],
    ["relatedParty", "relatedPartyEvidence"],
  ] as const) {
    if (typeof facts[flag] !== "boolean") return `Assessment facts require explicit ${flag}`;
    if (facts[flag] && !nonBlank(facts[evidence])) {
      return `Assessment facts require ${evidence} when ${flag} is true`;
    }
  }
  if (input.kind === "lease") {
    const transition = assessment.conclusion?.leaseTransition;
    if (!transition || typeof transition !== "object") {
      return "Lease predecessor relationships require leaseTransition evidence";
    }
    if (transition.predecessorLeaseType !== input.predecessorLeaseType) {
      return "leaseTransition.predecessorLeaseType must match the predecessor lease";
    }
    if (!transition.originalLeaseTerminated || !transition.replacementLeaseExecuted) {
      return "Lease transitions require confirmed termination and replacement execution";
    }
    if (!nonBlank(transition.terminationEvidenceReference) || !nonBlank(transition.entryEvidenceReference)) {
      return "Lease transitions require termination and entry evidence references";
    }
    if (transition.entryDate !== input.modificationEffectiveDate) {
      return "leaseTransition.entryDate must equal modificationEffectiveDate";
    }
    if (input.predecessorLeaseType === "operating") {
      if (
        !Number.isFinite(transition.predecessorDeferredRentAsset) ||
        transition.predecessorDeferredRentAsset < 0 ||
        !Number.isFinite(transition.predecessorDeferredRentLiability) ||
        transition.predecessorDeferredRentLiability < 0
      ) {
        return "Operating lease transitions require explicit nonnegative predecessorDeferredRentAsset and predecessorDeferredRentLiability balances";
      }
    } else {
      if (
        !Number.isFinite(transition.predecessorAssetCost) ||
        transition.predecessorAssetCost < 0 ||
        !Number.isFinite(transition.predecessorAccumulatedDepreciation) ||
        transition.predecessorAccumulatedDepreciation < 0 ||
        transition.predecessorAccumulatedDepreciation > transition.predecessorAssetCost
      ) {
        return "Capital lease transitions require explicit valid predecessorAssetCost and predecessorAccumulatedDepreciation balances";
      }
    }
    if (
      input.successorLeaseType === "capital" &&
      (!Number.isFinite(transition.successorInitialAmount) || transition.successorInitialAmount <= 0)
    ) {
      return "Capital lease successors require successorInitialAmount greater than zero";
    }
    return null;
  }

  const test = assessment.evidence?.quantitativeTest;
  if (!test || typeof test !== "object") return "Loan assessments require a quantitative 10% test";
  if (!Number.isFinite(test.retainedFeesAndCosts) || test.retainedFeesAndCosts < 0) {
    return "quantitativeTest.retainedFeesAndCosts must be a finite nonnegative prior unamortized balance";
  }
  if (!nonBlank(test.retainedFeesAndCostsSourceReference)) {
    return "quantitativeTest.retainedFeesAndCostsSourceReference is required even when retained fees and costs are zero";
  }
  if (
    !Number.isFinite(test.newFeesAndCosts) ||
    test.newFeesAndCosts < 0 ||
    !sameNumber(test.creditorFees + test.otherTransactionCosts, test.newFeesAndCosts)
  ) {
    return "quantitativeTest.newFeesAndCosts must equal creditorFees plus otherTransactionCosts";
  }
  if (
    test.settlementConsideration !== undefined &&
    (!Number.isFinite(test.settlementConsideration) || test.settlementConsideration < 0)
  ) {
    return "quantitativeTest.settlementConsideration must be a finite nonnegative number";
  }
  if (
    assessment.conclusion?.accountingTreatment === "extinguishment" &&
    (!Number.isFinite(test.settlementConsideration) || test.settlementConsideration <= 0)
  ) {
    return "Loan extinguishment conclusions require settlementConsideration greater than zero";
  }
  if (!sameNumber(input.predecessorOriginalEffectiveRate, test.originalEffectiveRate)) {
    return "quantitativeTest.originalEffectiveRate must equal the predecessor fair-value rate when use_fv is confirmed, otherwise its contractual opening rate";
  }
  try {
    const cashFlows = (flows: any[]) => flows.map((flow) => ({
      date: new Date(`${flow.date}T00:00:00.000Z`),
      amount: flow.amount,
      description: flow.description,
      evidenceReference: flow.sourceReference,
    }));
    const result = assessAspe3856Modification({
      modificationDate: effective,
      carryingAmount: test.carryingAmount,
      originalEffectiveRate: test.originalEffectiveRate,
      originalRemainingCashFlows: cashFlows(test.originalRemainingCashFlows),
      modifiedCashFlows: cashFlows(test.modifiedCashFlows),
      sameDayPaymentTreatment: test.sameDayPaymentTreatment,
      creditorFees: test.creditorFees,
      otherTransactionCosts: test.otherTransactionCosts,
      accruedInterest: test.accruedInterest,
      accruedInterestTreatment: test.accruedInterestTreatment,
    }, {
      creditorChanged: facts.creditorChanged,
      legalDischarge: facts.legalDischarge,
      relatedParty: facts.relatedParty,
    });
    // Derived client values can be stale or differ because browser and server
    // bundles were built from different calculator revisions. Raw contractual
    // inputs are validated above and by the engine; persist only the canonical
    // server result rather than rejecting harmless derived-value drift.
    test.predecessorAmount = result.tenPercentTest.presentValueOfOriginalRemainingCashFlows;
    test.successorAmount = result.tenPercentTest.presentValueOfModifiedCashFlows;
    test.presentValueOfOriginalRemainingCashFlows =
      result.tenPercentTest.presentValueOfOriginalRemainingCashFlows;
    test.presentValueOfModifiedCashFlows =
      result.tenPercentTest.presentValueOfModifiedCashFlows;
    test.differenceAmount = result.tenPercentTest.difference;
    test.differencePercent = result.tenPercentTest.differencePercent;
    test.recommendation = result.recommendation;
    if (
      assessment.status === "confirmed" &&
      assessment.conclusion?.accountingTreatment === "continuation"
    ) {
      try {
        calculateProspectiveModificationSchedule({
          effectiveDate: effective,
          openingCarryingAmount: test.carryingAmount,
          retainedFeesAndCosts: test.retainedFeesAndCosts,
          newFeesAndCosts: test.newFeesAndCosts,
          modifiedCashFlows: cashFlows(test.modifiedCashFlows),
          sameDayPaymentTreatment: test.sameDayPaymentTreatment,
        });
      } catch (error) {
        const detail = error instanceof Error ? `: ${error.message}` : "";
        return `Invalid loan continuation evidence${detail}`;
      }
    }
  } catch (error) {
    return error instanceof Error ? `Invalid quantitative test: ${error.message}` : "Invalid quantitative test";
  }
  return null;
};

const nonBlank = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const validateConfirmedModificationAssessment = (
  value: unknown,
): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "modificationAssessment is required and must be an object";
  }
  const assessment = value as Record<string, unknown>;
  if (assessment.status !== "confirmed") {
    return "modificationAssessment must be confirmed";
  }
  if (!nonBlank(assessment.assessmentDate) || !nonBlank(assessment.confirmedAt)) {
    return "A confirmed modificationAssessment requires assessmentDate and confirmedAt";
  }
  if (!nonBlank(assessment.confirmedBy)) {
    return "A confirmed modificationAssessment requires confirmedBy";
  }
  const evidence = assessment.evidence as Record<string, unknown> | undefined;
  if (!evidence || !nonBlank(evidence.changeSummary)) {
    return "A confirmed modificationAssessment requires an evidence changeSummary";
  }
  if (!Array.isArray(evidence.contractualChanges) || evidence.contractualChanges.length === 0) {
    return "A confirmed modificationAssessment requires at least one contractual change";
  }
  for (const change of evidence.contractualChanges) {
    if (!change || typeof change !== "object") {
      return "Each contractual change must contain complete evidence";
    }
    const item = change as Record<string, unknown>;
    if (
      !nonBlank(item.term) ||
      !nonBlank(item.predecessorValue) ||
      !nonBlank(item.successorValue) ||
      !nonBlank(item.significance) ||
      !nonBlank(item.sourceReference)
    ) {
      return "Each contractual change requires term, predecessorValue, successorValue, significance, and sourceReference";
    }
  }
  const conclusion = assessment.conclusion as Record<string, unknown> | undefined;
  if (
    !conclusion ||
    !["renewal", "modification"].includes(String(conclusion.agreementChangeType)) ||
    !["continuation", "extinguishment", "new_lease"].includes(String(conclusion.accountingTreatment)) ||
    !nonBlank(conclusion.rationale)
  ) {
    return "A confirmed modificationAssessment requires a complete conclusion and rationale";
  }
  return null;
};