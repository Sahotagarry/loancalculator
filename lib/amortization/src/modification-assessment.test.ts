import { describe, expect, it } from "vitest";
import {
  assessAspe3856Modification,
  assessLeaseChange,
  calculateAspe3856TenPercentTest,
  calculateProspectiveModificationSchedule,
} from "./index";

const CHANGE_DATE = new Date("2025-01-01T00:00:00.000Z");

describe("ASPE 3856 dated 10% test", () => {
  it("uses full precision and treats the 10% boundary as inclusive", () => {
    const result = calculateAspe3856TenPercentTest({
      modificationDate: CHANGE_DATE,
      // Deliberately different from original PV: carrying amount is entry
      // evidence and must not dilute the 10% denominator.
      carryingAmount: 2_000,
      originalEffectiveRate: 5,
      originalRemainingCashFlows: [{ date: CHANGE_DATE, amount: 1_000 }],
      modifiedCashFlows: [{ date: CHANGE_DATE, amount: 1_100 }],
      sameDayPaymentTreatment: "include",
    });

    expect(result.differenceRatio).toBeCloseTo(0.1, 14);
    expect(result.meetsTenPercentThreshold).toBe(true);
    expect(result.carryingAmountTested).toBe(2_000);
    expect(result.presentValueOfOriginalRemainingCashFlows).toBe(1_000);
  });

  it("makes same-day treatment explicit and separates creditor fees from other costs", () => {
    const result = calculateAspe3856TenPercentTest({
      modificationDate: CHANGE_DATE,
      carryingAmount: 1_000,
      originalEffectiveRate: 0,
      originalRemainingCashFlows: [
        { date: CHANGE_DATE, amount: 100, description: "payment due on change date" },
        { date: new Date("2026-01-01T00:00:00.000Z"), amount: 900 },
      ],
      modifiedCashFlows: [
        { date: CHANGE_DATE, amount: 100, description: "payment due on change date" },
        { date: new Date("2026-01-01T00:00:00.000Z"), amount: 900 },
      ],
      sameDayPaymentTreatment: "exclude",
      creditorFees: 20,
      otherTransactionCosts: 35,
    });

    expect(result.presentValueOfModifiedCashFlows).toBe(920);
    expect(result.excludedSameDayCashFlows).toHaveLength(1);
    expect(result.creditorFeesIncluded).toBe(20);
    expect(result.otherTransactionCostsExcluded).toBe(35);
  });

  it("documents accrued interest treatment and legal/related-party facts", () => {
    const assessment = assessAspe3856Modification(
      {
        modificationDate: CHANGE_DATE,
        carryingAmount: 1_000,
        originalEffectiveRate: 0,
        originalRemainingCashFlows: [{ date: CHANGE_DATE, amount: 1_050 }],
        modifiedCashFlows: [{ date: CHANGE_DATE, amount: 1_050 }],
        sameDayPaymentTreatment: "include",
        accruedInterest: 50,
        accruedInterestTreatment: "add_to_carrying_amount",
      },
      {
        legalDischarge: true,
        relatedParty: true,
        legalEvidenceReference: "release.pdf",
        relatedPartyEvidenceReference: "relationship memo",
      },
    );

    expect(assessment.tenPercentTest.carryingAmountTested).toBe(1_050);
    expect(assessment.recommendation).toBe("derecognize_original");
    expect(assessment.relatedPartyJudgmentRequired).toBe(true);
  });

  it("discounts dated cash flows at the original effective rate", () => {
    const result = calculateAspe3856TenPercentTest({
      modificationDate: CHANGE_DATE,
      carryingAmount: 1_000,
      originalEffectiveRate: 10,
      originalRemainingCashFlows: [{ date: new Date("2026-01-01T00:00:00.000Z"), amount: 1_000 }],
      modifiedCashFlows: [{ date: new Date("2026-01-01T00:00:00.000Z"), amount: 1_100 }],
      sameDayPaymentTreatment: "include",
    });

    expect(result.presentValueOfModifiedCashFlows).toBeCloseTo(1_000, 10);
    expect(result.meetsTenPercentThreshold).toBe(false);
  });
});

describe("lease change recommendation", () => {
  it("recommends a new lease and checks transition-entry evidence", () => {
    const incomplete = assessLeaseChange({
      originalLeaseLegallyTerminated: true,
      replacementLeaseExecuted: true,
      legalEvidenceReference: "termination and replacement agreements",
    });
    expect(incomplete.recommendation).toBe("new_lease");
    expect(incomplete.transitionEntryEvidenceRequired).toBe(true);
    expect(incomplete.transitionEntryEvidenceComplete).toBe(false);

    const complete = assessLeaseChange({
      originalLeaseLegallyTerminated: true,
      transitionEntryEvidence: {
        entryDate: CHANGE_DATE,
        debitAccount: "Right-of-use asset",
        creditAccount: "Lease liability",
        amount: 25_000,
        evidenceReference: "JE-2025-001",
      },
    });
    expect(complete.transitionEntryEvidenceComplete).toBe(true);
  });

  it("treats changed provisions as a new lease under the ASPE 3065 workflow", () => {
    expect(assessLeaseChange({
      addsRightOfUse: true,
      addedConsiderationAtStandalonePrice: true,
    }).recommendation).toBe("new_lease");

    expect(assessLeaseChange({
      addsRightOfUse: true,
      addedConsiderationAtStandalonePrice: false,
    }).recommendation).toBe("new_lease");
  });
});

describe("prospective non-substantial modification schedule", () => {
  it("solves an annual rate whose dated payment PV converges to the fee-adjusted basis", () => {
    const result = calculateProspectiveModificationSchedule({
      effectiveDate: CHANGE_DATE,
      openingCarryingAmount: 1_000,
      retainedFeesAndCosts: 30,
      newFeesAndCosts: 20,
      modifiedCashFlows: [{ date: new Date("2026-01-01T00:00:00.000Z"), amount: 1_100 }],
      sameDayPaymentTreatment: "include",
    });
    const annualRate = result.resultingEffectiveAnnualRate / 100;
    const pv = result.includedCashFlows.reduce(
      (total, flow) =>
        total + flow.amount / Math.pow(1 + annualRate, (flow.date.getTime() - CHANGE_DATE.getTime()) / (365 * 24 * 60 * 60 * 1000)),
      0,
    );

    expect(result.effectiveInterestBasis).toBe(950);
    expect(pv).toBeCloseTo(result.effectiveInterestBasis, 10);
    expect(result.schedule.at(-1)?.balance).toBeCloseTo(0, 10);
  });

  it("amortizes retained and new fees through effective interest", () => {
    const withFees = calculateProspectiveModificationSchedule({
      effectiveDate: CHANGE_DATE,
      openingCarryingAmount: 1_000,
      retainedFeesAndCosts: 50,
      newFeesAndCosts: 0,
      modifiedCashFlows: [{ date: new Date("2026-01-01T00:00:00.000Z"), amount: 1_100 }],
      sameDayPaymentTreatment: "include",
    });
    const withoutFees = calculateProspectiveModificationSchedule({
      effectiveDate: CHANGE_DATE,
      openingCarryingAmount: 1_000,
      retainedFeesAndCosts: 0,
      newFeesAndCosts: 0,
      modifiedCashFlows: [{ date: new Date("2026-01-01T00:00:00.000Z"), amount: 1_100 }],
      sameDayPaymentTreatment: "include",
    });

    expect(withFees.resultingEffectiveAnnualRate).toBeGreaterThan(withoutFees.resultingEffectiveAnnualRate);
    expect(withFees.schedule[0].interest).toBeCloseTo(150, 10);
  });

  it("keeps excluded same-day cash flows as evidence but out of the schedule", () => {
    const result = calculateProspectiveModificationSchedule({
      effectiveDate: CHANGE_DATE,
      openingCarryingAmount: 900,
      retainedFeesAndCosts: 0,
      newFeesAndCosts: 0,
      modifiedCashFlows: [
        { date: CHANGE_DATE, amount: 100 },
        { date: new Date("2026-01-01T00:00:00.000Z"), amount: 990 },
      ],
      sameDayPaymentTreatment: "exclude",
    });

    expect(result.excludedSameDayCashFlows).toHaveLength(1);
    expect(result.schedule).toHaveLength(1);
    expect(result.schedule[0].payment).toBe(990);
    expect(result.schedule[0].balance).toBeCloseTo(0, 10);
  });
});