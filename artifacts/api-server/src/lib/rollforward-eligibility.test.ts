import { describe, expect, it } from "vitest";
import type { Loan, LoanEvent } from "@workspace/db";
import { isLoanOutstandingAt } from "./rollforward-eligibility";

const loan = {
  id: "loan-1",
  principal: "1000.00",
  downPayment: "0.00",
  interestRate: "0.00",
  amortizationYears: 1,
  termYears: 1,
  termMonths: 12,
  startDate: "2025-01-01",
  paymentFrequency: "monthly",
  paymentTiming: "end",
  graceTermMode: "included",
  firstPaymentDate: null,
  semiMonthlyFirstDueDay: null,
  semiMonthlySecondDueDay: null,
  ioMonths: 0,
  specificIoMonths: "",
  graceMonths: 0,
  graceInterestTreatment: "capitalized",
  balloonPayment: "0.00",
  paymentOverride: null,
} as Loan;

const event = (amount: string): LoanEvent => ({
  id: `event-${amount}`,
  setId: "set-1",
  loanId: loan.id,
  termRevisionId: "revision-1",
  kind: "principal_prepayment",
  effectiveDate: "2025-01-01",
  ordering: "after_scheduled_payment",
  sequence: 1,
  amount,
  treatment: "keep_payment",
  classification: "ordinary",
  source: "agreement",
  reason: "lump sum",
  authoredAt: new Date("2024-12-01T00:00:00Z"),
  author: null,
  supersedesEventId: null,
  originEventId: null,
});

describe("roll-forward event-adjusted eligibility", () => {
  it("excludes a keep-payment loan paid off before FYE", () => {
    expect(isLoanOutstandingAt(loan, [event("916.67")], "2025-06-30")).toBe(false);
  });

  it("retains a loan with event-adjusted payments remaining after FYE", () => {
    expect(isLoanOutstandingAt(loan, [event("100.00")], "2025-06-30")).toBe(true);
  });

  it("does not treat a future agreement as a source-year obligation", () => {
    expect(isLoanOutstandingAt(
      { ...loan, startDate: "2026-01-01" },
      [],
      "2025-12-31",
    )).toBe(false);
  });

  it("includes grace-added terms and contractual balloons", () => {
    expect(isLoanOutstandingAt(
      { ...loan, graceMonths: 6, graceTermMode: "added" },
      [],
      "2026-03-31",
    )).toBe(true);
    expect(isLoanOutstandingAt(
      { ...loan, balloonPayment: "500.00" },
      [],
      "2025-12-31",
    )).toBe(true);
  });

  it("uses variable-rate reset evidence in the finalized schedule", () => {
    const reset = {
      ...event("100.00"),
      id: "rate-1",
      kind: "rate_reset",
      amount: null,
      observationDate: "2025-01-01",
      publishedDate: "2025-01-01",
      fetchedAt: new Date("2025-01-01T12:00:00Z"),
      benchmarkRate: "4.0000",
      spread: "1.0000",
      resultingRate: "5.0000",
      benchmark: "boc_v80691311",
      sourceUrl: "https://www.bankofcanada.ca/",
      sourceSeries: "V80691311",
      rateOrigin: "override",
      treatment: "keep_maturity",
    } as LoanEvent;
    expect(isLoanOutstandingAt(
      { ...loan, rateType: "prime_linked" },
      [reset],
      "2025-06-30",
    )).toBe(true);
  });
});