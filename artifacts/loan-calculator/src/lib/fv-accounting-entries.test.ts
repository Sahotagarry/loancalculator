import { describe, expect, it } from "vitest";
import {
  buildAnnualEffectiveInterestJournalEntry,
  buildCumulativeFairValueReconciliation,
  buildDayOneFairValueJournalEntry,
  buildFairValueAccountingEntries,
} from "./aspe-utils";
import { buildLoanWorkpaper } from "./workpaper-export";

const base = {
  id: "loan-1",
  name: "Related party loan",
  counterparty: "Shareholder",
  description: "",
  principal: 100_000,
  downPayment: 0,
  interestRate: 2,
  amortizationYears: 3,
  termYears: 3,
  startDate: "2024-01-01",
  paymentFrequency: "monthly",
  fvDecision: "use_fv",
  fvRate: 8,
};

const expectBalanced = (lines: Array<{ debit: number; credit: number }>) => {
  expect(lines.reduce((sum, line) => sum + line.debit, 0))
    .toBeCloseTo(lines.reduce((sum, line) => sum + line.credit, 0), 2);
};

describe("fair value accounting entry builders", () => {
  it("builds balanced day-one and annual entries with loan/lease labels", () => {
    const dayOne = buildDayOneFairValueJournalEntry({
      recognitionDate: "2024-01-01", faceAmount: 100, fairValue: 80,
      evidence: { source: "approved assessment" },
    });
    expect(dayOne.purpose).toBe("day_one_fair_value");
    expect(dayOne.lines[0].account).toBe("Loan Payable");
    expect(dayOne.evidence.source).toBe("approved assessment");
    expectBalanced(dayOne.lines);

    const annual = buildAnnualEffectiveInterestJournalEntry({
      entryDate: "2024-12-31", fiscalYear: 2024, effectiveInterest: 12,
      statedContractualInterest: 5, isCapitalLease: true,
    });
    expect(annual.lines.map((line) => line.account)).toEqual([
      "Interest Expense", "Obligation under Capital Lease",
    ]);
    expect(annual.lines.some((line) => line.account.includes("Retained"))).toBe(false);
    expectBalanced(annual.lines);
  });

  it("keeps opening retained earnings only in balanced cumulative support", () => {
    const support = buildCumulativeFairValueReconciliation({
      entryDate: "2025-12-31", fiscalYear: 2025, effectiveInterest: 12,
      statedContractualInterest: 5, dayOneDifference: 30, priorYearsAccretion: 8,
    });
    expect(support.purpose).toBe("cumulative_fair_value_reconciliation");
    expect(support.label).toContain("support only");
    expect(support.lines.some((line) => line.account === "Retained Earnings (opening)")).toBe(true);
    expectBalanced(support.lines);
  });

  it("honours beginning/end timing and event-adjusted cash flows", () => {
    const event = {
      id: "prepay-1", effectiveDate: "2024-08-15",
      ordering: "before_scheduled_payment" as const, sequence: 1,
      amount: 10_000, treatment: "keep_payment" as const,
    };
    const end = buildFairValueAccountingEntries({
      loan: { ...base, paymentTiming: "end", activeEvents: [event] },
      reportingFiscalYearEnd: "2026-12-31",
    });
    const beginning = buildFairValueAccountingEntries({
      loan: { ...base, paymentTiming: "beginning", activeEvents: [event] },
      reportingFiscalYearEnd: "2026-12-31",
    });
    const withoutEvent = buildFairValueAccountingEntries({
      loan: { ...base, paymentTiming: "end" },
      reportingFiscalYearEnd: "2026-12-31",
    });
    expect(end.dayOne!.evidence.activeEventCount).toBe(1);
    expect(end.dayOne!.evidence.fairValue).not.toBe(withoutEvent.dayOne!.evidence.fairValue);
    expect(beginning.dayOne!.evidence.fairValue).not.toBe(end.dayOne!.evidence.fairValue);
    expect(end.annualEntries.length).toBeGreaterThan(1);
    end.annualEntries.forEach((entry) => expectBalanced(entry.lines));
  });

  it("freezes prime assumptions for day one while realized resets affect annual activity", () => {
    const frozen = {
      events: [{
        id: "approved", effectiveDate: "2024-07-01", benchmarkRate: 4,
        spread: 1, resultingContractualRate: 5,
      }],
    };
    const realized = (rate: number) => [{
      id: `actual-${rate}`, effectiveDate: "2024-07-01", benchmarkRate: rate - 1,
      spread: 1, resultingContractualRate: rate,
    }];
    const low = buildFairValueAccountingEntries({
      loan: { ...base, rateType: "prime_linked", initialFvRateAssumption: frozen, activeRateEvents: realized(6) },
      reportingFiscalYearEnd: "2025-12-31",
    });
    const high = buildFairValueAccountingEntries({
      loan: { ...base, rateType: "prime_linked", initialFvRateAssumption: frozen, activeRateEvents: realized(11) },
      reportingFiscalYearEnd: "2025-12-31",
    });
    expect(low.dayOne!.evidence.fairValue).toBe(high.dayOne!.evidence.fairValue);
    expect(low.dayOne!.evidence).not.toHaveProperty("activeRateEventCount");
    expect(low.dayOne!.evidence).not.toHaveProperty("activeRateSetId");
    expect(low.annualEntries[0].evidence.statedContractualInterest)
      .not.toBe(high.annualEntries[0].evidence.statedContractualInterest);
  });

  it.each(["trivial", "immaterial", null] as const)(
    "does not manufacture entries for %s treatment",
    (fvDecision) => {
      const decisionHistory: any = fvDecision ? {
        status: "current",
        current: { treatment: fvDecision, marketEffectiveRate: 8, rationaleNote: "Test" }
      } : null;
      const result = buildFairValueAccountingEntries({
        loan: { ...base, fvDecision },
        decisionHistory,
        reportingFiscalYearEnd: "2025-12-31",
      });
      expect(result.treatment).toBe(fvDecision);
      expect(result.dayOne).toBeNull();
      expect(result.annualEntries).toEqual([]);
      expect(result.cumulativeSupport).toEqual([]);
      expect(result.decisionHistory).toBe(decisionHistory);
    },
  );

  it("uses the shared builders in workpapers with distinct labels", () => {
    const workpaper = buildLoanWorkpaper(base as any, {
      clientName: "Client", fiscalYearEnd: "2025-12-31",
    });
    const titles = workpaper!.sections.map((section) => section.title);
    expect(titles).toContain("Day-one Fair Value Journal Entry");
    expect(titles).toContain("Annual Effective-interest / Accretion Journal Entries");
    expect(titles.some((title) => title.includes("Support Only"))).toBe(true);
  });
});