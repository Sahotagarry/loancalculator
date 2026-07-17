import { describe, it, expect } from "vitest";
import { buildLoanSummary, calculateBookedSchedule } from "./aspe-utils";
import type { LoanSummary, CapitalLeaseSummary } from "./aspe-utils";

const reportYearEnd = new Date(2025, 11, 31);
const fyEnd = "2025-12-31";

const base = {
  id: "x",
  name: "Item",
  principal: 120000,
  interestRate: 6,
  amortizationYears: 5,
  termYears: 5,
  startDate: "2025-01-15",
  paymentFrequency: "monthly",
};

describe("down payment on loans and capital leases", () => {
  it("amortizes the financed amount for a loan", () => {
    const withDp = calculateBookedSchedule({ ...base, downPayment: 20000 });
    const without = calculateBookedSchedule({ ...base, downPayment: 0 });
    expect(withDp.schedule[0].balance).toBeLessThan(without.schedule[0].balance);
    const financed = calculateBookedSchedule({ ...base, principal: 100000, downPayment: 0 });
    expect(withDp.monthlyPayment).toBeCloseTo(financed.monthlyPayment, 2);
  });

  it("nets the down payment for a capital lease summary", () => {
    const s = buildLoanSummary(
      { ...base, isCapitalLease: true, downPayment: 20000 },
      reportYearEnd,
      fyEnd,
    ) as CapitalLeaseSummary;
    const equivalent = buildLoanSummary(
      { ...base, principal: 100000, isCapitalLease: true },
      reportYearEnd,
      fyEnd,
    ) as CapitalLeaseSummary;
    expect(s.isCapitalLease).toBe(true);
    expect(s.balanceAtYearEnd).toBeCloseTo(equivalent.balanceAtYearEnd, 2);
    expect(s.currentPortion).toBeCloseTo(equivalent.currentPortion, 2);
    expect(s.regularPayment).toBeCloseTo(equivalent.regularPayment, 2);
  });

  it("produces identical loan and lease obligation math for the same inputs", () => {
    const loan = buildLoanSummary(
      { ...base, downPayment: 15000 },
      reportYearEnd,
      fyEnd,
    ) as LoanSummary;
    const lease = buildLoanSummary(
      { ...base, downPayment: 15000, isCapitalLease: true },
      reportYearEnd,
      fyEnd,
    ) as CapitalLeaseSummary;
    expect(lease.balanceAtYearEnd).toBeCloseTo(loan.balanceAtYearEnd, 2);
  });
});

import { calculatePVFromAnswers, type AssessmentAnswers } from "../components/capital-lease-assessment";

const wizardBase: AssessmentAnswers = {
  transferOfOwnership: false,
  bargainPurchaseOption: false,
  leaseTermPct: 0,
  pvPctFairValue: 0,
  fairValue: 100000,
  specializedAsset: false,
  assetType: "",
  economicLife: 0,
  termMonths: 60,
  monthlyPayment: 1800,
  downPayment: 0,
  interestRate: 6,
  paymentAtBeginning: false,
  paymentIncludesTax: false,
  taxType: "none",
  taxRate: 0,
  buyoutForImplicitRate: 0,
};

describe("wizard PV test includes down payment", () => {
  it("adds the down payment at face value to the PV of payments", () => {
    const without = calculatePVFromAnswers(wizardBase);
    const withDp = calculatePVFromAnswers({ ...wizardBase, downPayment: 10000 });
    expect(withDp).toBeCloseTo(without + 10000, 2);
  });

  it("downstream schedule amortizes pvValue minus down payment", () => {
    const pvValue = calculatePVFromAnswers({ ...wizardBase, downPayment: 10000 });
    const booked = calculateBookedSchedule({
      principal: pvValue,
      downPayment: 10000,
      interestRate: 6,
      amortizationYears: 5,
      termYears: 5,
      startDate: "2025-01-15",
      paymentFrequency: "monthly",
    });
    const openingBalance = booked.schedule[0].balance + booked.schedule[0].principal;
    expect(openingBalance).toBeCloseTo(pvValue - 10000, 0);
  });
});
