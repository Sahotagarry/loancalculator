import { describe, expect, it } from "vitest";
import type { Loan } from "@workspace/db";
import {
  buildContractSnapshot,
  hashContractSnapshot,
} from "./loan-contract-revisions";

const loan = {
  id: "loan-1",
  fileId: "file-1",
  name: "Test loan",
  principal: "100000.00",
  downPayment: "0.00",
  interestRate: "5.00",
  amortizationYears: 10,
  termYears: 5,
  termMonths: null,
  startDate: "2025-01-01",
  fiscalYearEnd: "2025-12-31",
  paymentFrequency: "monthly",
  paymentTiming: "end",
  graceTermMode: "included",
  firstPaymentDate: null,
  semiMonthlyFirstDueDay: null,
  semiMonthlySecondDueDay: null,
  graceMonths: 0,
  graceInterestTreatment: "capitalized",
  ioMonths: 0,
  specificIoMonths: "",
  balloonPayment: "0.00",
  monthlyPayment: null,
  paymentOverride: null,
  freeRentMonths: 0,
  rentEscalationRate: "0.00",
  rentSteps: null,
  tenantImprovementAllowance: "0.00",
  otherInducements: "0.00",
  inducementReceivedInCash: false,
  fvRate: null,
  isCapitalLease: false,
} as Loan;

describe("loan contract revision evidence", () => {
  it("creates the same hash for equivalent snapshots", () => {
    const snapshot = buildContractSnapshot(loan);
    const reordered = Object.fromEntries(Object.entries(snapshot).reverse());
    expect(hashContractSnapshot(reordered)).toBe(hashContractSnapshot(snapshot));
  });

  it("changes the hash when a schedule-driving term changes", () => {
    const original = buildContractSnapshot(loan);
    const changed = buildContractSnapshot({ ...loan, paymentTiming: "beginning" });
    expect(hashContractSnapshot(changed)).not.toBe(hashContractSnapshot(original));
  });

  it("captures nullable payment-calendar terms", () => {
    expect(buildContractSnapshot(loan)).toMatchObject({
      paymentTiming: "end",
      graceTermMode: "included",
      firstPaymentDate: null,
      semiMonthlyFirstDueDay: null,
      semiMonthlySecondDueDay: null,
    });
  });

  it("does not rewrite contractual cash-flow evidence for an FV decision", () => {
    const original = buildContractSnapshot(loan);
    const decided = buildContractSnapshot({
      ...loan,
      fvRate: "5.25",
      fvDecision: "use_fv",
      fvDecisionNote: "Confirmed separately",
    });
    expect(hashContractSnapshot(decided)).toBe(hashContractSnapshot(original));
  });
});