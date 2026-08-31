import { describe, expect, it } from "vitest";
import type { FileSummary } from "./aspe-utils";
import {
  buildDisclosureModel,
  DisclosureEvidenceError,
  type DisclosureAgreementInput,
} from "./disclosure-model";
import {
  buildPresentationDisclosureDocxPlan,
  buildPresentationDisclosurePdfPlan,
  serializeDisclosureRenderPlan,
} from "./disclosure-export";

const emptySummary = (): FileSummary => ({
  loans: [],
  capitalLeases: [],
  operatingLeases: [],
  loanTotal: 0,
  leaseTotal: 0,
  loanCurrent: 0,
  loanLongTerm: 0,
  leaseCurrent: 0,
  leaseLongTerm: 0,
  totalDebt: 0,
  totalCurrent: 0,
  totalLongTerm: 0,
  operatingLeaseCount: 0,
  operatingLeaseTotalCommitment: 0,
  operatingLeaseMonthlyTotal: 0,
  deferredRentAsset: 0,
  deferredRentLiability: 0,
  leaseIncentiveLiability: 0,
  leaseIncentiveCurrent: 0,
  leaseIncentiveNonCurrent: 0,
  totalInterestExpense: 0,
  totalStraightLineRentExpense: 0,
  totalLeaseInducementAmortization: 0,
  totalLoanProceeds: 0,
  totalPrincipalRepaid: 0,
  totalLoanPrincipalRepaid: 0,
  totalCapitalLeasePrincipalRepaid: 0,
  totalInterestPaid: 0,
  totalOperatingLeaseCash: 0,
  cashInducementsReceived: 0,
  nonCashInducementsReceived: 0,
});

const debtSummary = (id: string, yearlyPrincipal: Array<{ label: string; amount: number }>) => ({
  id,
  name: id,
  counterparty: "Bank",
  description: "Debt",
  interestRate: 5,
  maturityDate: "December 31, 2030",
  regularPayment: 100,
  paymentFrequency: "monthly",
  balanceAtYearEnd: yearlyPrincipal.reduce((sum, row) => sum + row.amount, 0),
  currentPortion: yearlyPrincipal[0]?.amount ?? 0,
  longTermPortion: yearlyPrincipal.slice(1).reduce((sum, row) => sum + row.amount, 0),
  covenantViolation: false,
  scheduledWithinOneYear: yearlyPrincipal[0]?.amount ?? 0,
  scheduledBeyondOneYear: yearlyPrincipal.slice(1).reduce((sum, row) => sum + row.amount, 0),
  yearlyPrincipal: yearlyPrincipal.map((row, index) => ({ ...row, fiscalYear: 2027 + index })),
  yearlyInterest: [],
  principalRepaidCurrentFY: 0,
  isCapitalLease: false as const,
  isOperatingLease: false as const,
  collateralNbv: null,
});

function fixture() {
  const summary = emptySummary();
  summary.loans = [debtSummary("loan-1", [
    { label: "2027", amount: 20 },
    { label: "2030", amount: 80 }, // contractual balloon/residual already in canonical summary
  ])];
  summary.loanTotal = summary.totalDebt = 100;
  summary.loanCurrent = summary.totalCurrent = 20;
  summary.loanLongTerm = summary.totalLongTerm = 80;
  summary.totalInterestExpense = 6;
  summary.totalLoanPrincipalRepaid = summary.totalPrincipalRepaid = 12;
  summary.totalLoanProceeds = 50;
  const agreements: DisclosureAgreementInput[] = [{
    id: "loan-1",
    name: "Modified facility",
    rolledFromId: "prior-loan-1",
    counterparty: "Bank",
    securityClauses: ["General security agreement"],
    covenantViolation: true,
    predecessorAgreementId: "old-contract",
    predecessorAgreement: { id: "old-contract" },
    modificationEffectiveDate: "2026-07-01",
    modificationAssessment: { status: "confirmed", conclusion: { accountingTreatment: "continuation" } },
    calculationVersion: "calc-4",
    currentRevisionId: "revision-7",
    currentRevisionHash: "revision-sha",
    activeEventSetId: "events-2",
    activeEventSetVersion: 2,
    activeEventSetHash: "events-sha",
    activeRateSetId: "rates-3",
  }];
  const prior = emptySummary();
  prior.loanTotal = prior.totalDebt = 130;
  prior.loanCurrent = prior.totalCurrent = 30;
  prior.loanLongTerm = prior.totalLongTerm = 100;
  prior.totalInterestExpense = 8;
  return { summary, agreements, prior };
}

describe("shared presentation and disclosure model", () => {
  it("reconciles screen-ready classifications, balloons, groupings, transitions, and evidence", () => {
    const { summary, agreements } = fixture();
    const model = buildDisclosureModel({
      clientName: "Example Co",
      fileName: "YE 2026",
      fiscalYearEnd: "2026-12-31",
      agreements,
      summary,
      reportingTransitionsReady: true,
      masters: [{ id: "master", lender: "Bank", covenantDescription: "DSCR >= 1.25" }],
    });
    expect(model.balanceSheet.totalDebt.total.current).toBe(100);
    expect(model.balanceSheet.totalDebt.current.current + model.balanceSheet.totalDebt.nonCurrent.current).toBe(100);
    expect(model.maturities.reduce((sum, row) => sum + row.loans, 0)).toBe(100);
    expect(model.maturities.find((row) => row.label === "2030")?.loans).toBe(80);
    expect(model.securityAndCovenants[0]).toMatchObject({
      security: ["General security agreement"],
      covenantViolation: true,
    });
    expect(model.transitions).toEqual([expect.objectContaining({
      predecessorAgreementId: "old-contract",
      presentation: "single_timeline_no_double_count",
    })]);
    expect(model.evidence).toMatchObject({
      evidenceVersion: "disclosure-evidence/v1",
      calculationVersions: ["calc-4"],
      revisionFingerprints: ["revision-sha"],
      eventSetFingerprints: ["events-sha"],
      rateSetIds: ["rates-3"],
      state: "resolved",
    });
    expect(model.evidence.inputFingerprints[0]).toMatch(/^fnv1a-/);
    expect(model.modelFingerprint).toMatch(/^fnv1a-/);
  });

  it("uses explicit rolledFrom lineage comparatives and rejects unrelated inputs", () => {
    const { summary, agreements, prior } = fixture();
    const model = buildDisclosureModel({
      clientName: "Example Co",
      fiscalYearEnd: "2026-12-31",
      agreements,
      summary,
      reportingTransitionsReady: true,
      comparative: {
        summary: prior,
        fiscalYearEnd: "2025-12-31",
        sourceFileId: "prior-file",
        rolledFromLoanIds: ["prior-loan-1"],
      },
    });
    expect(model.balanceSheet.loans.total.comparative).toBe(130);
    expect(model.operations.interestExpense.comparative).toBe(8);
    expect(model.evidence.comparativeSourceFileId).toBe("prior-file");
    expect(() => buildDisclosureModel({
      clientName: "Example Co",
      fiscalYearEnd: "2026-12-31",
      agreements,
      summary,
      reportingTransitionsReady: true,
      comparative: {
        summary: prior,
        fiscalYearEnd: "2025-12-31",
        sourceFileId: "unrelated-file",
        rolledFromLoanIds: ["unrelated-loan"],
      },
    })).toThrow(DisclosureEvidenceError);
  });

  it("keeps file-lineage comparatives when no loans were carried forward", () => {
    const { summary, agreements, prior } = fixture();
    const model = buildDisclosureModel({
      clientName: "Example Co",
      fiscalYearEnd: "2026-12-31",
      rolledFromFileId: "prior-file",
      agreements: agreements.map((agreement) => ({ ...agreement, rolledFromId: null })),
      summary,
      reportingTransitionsReady: true,
      comparative: {
        summary: prior,
        fiscalYearEnd: "2025-12-31",
        sourceFileId: "prior-file",
        rolledFromLoanIds: [],
      },
    });

    expect(model.balanceSheet.loans.total.comparative).toBe(130);
    expect(model.evidence.comparativeSourceFileId).toBe("prior-file");
    expect(() => buildDisclosureModel({
      clientName: "Example Co",
      fiscalYearEnd: "2026-12-31",
      rolledFromFileId: "prior-file",
      agreements: [],
      summary,
      reportingTransitionsReady: true,
    })).toThrow("Comparative figures are unresolved");
  });

  it("gives Word and PDF identical deterministic sections and values", () => {
    const { summary, agreements } = fixture();
    const model = buildDisclosureModel({
      clientName: "Example Co",
      fiscalYearEnd: "2026-12-31",
      agreements,
      summary,
      reportingTransitionsReady: true,
    });
    expect(buildPresentationDisclosureDocxPlan(model)).toEqual(buildPresentationDisclosurePdfPlan(model));
    expect(serializeDisclosureRenderPlan(model)).toContain('"Contractual Maturities"');
    expect(serializeDisclosureRenderPlan(model)).toContain("$100.00");
  });

  it("fails closed when an external predecessor is loading or absent", () => {
    const { summary, agreements } = fixture();
    expect(() => buildDisclosureModel({
      clientName: "Example Co",
      fiscalYearEnd: "2026-12-31",
      agreements,
      summary,
      reportingTransitionsReady: false,
    })).toThrow("external predecessor evidence is unresolved");
    expect(() => buildDisclosureModel({
      clientName: "Example Co",
      fiscalYearEnd: "2026-12-31",
      agreements: [{ ...agreements[0], predecessorAgreement: null }],
      summary,
      reportingTransitionsReady: true,
    })).toThrow(DisclosureEvidenceError);
  });
});
