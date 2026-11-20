// Fictitious inputs only. No saved records or API calls are used to produce the samples.
import type { FileWorkpaperInput, WorkpaperLoanInput } from "./workpaper-export";
import { calculateBookedSchedule, buildFairValueAccountingEntries } from "./aspe-utils";
import { format } from "date-fns";

export const loan = {
  id: "sample-loan",
  name: "Illustrative equipment financing facility",
  counterparty: "Illustrative lender",
  principal: 85000,
  downPayment: 5000,
  interestRate: 3.125,
  amortizationYears: 5,
  termYears: 5,
  startDate: "2026-01-01",
  firstPaymentDate: "2026-02-01",
  paymentFrequency: "monthly",
  isCapitalLease: false,
  balloonPayment: 0,
  ioMonths: 0,
  covenantViolation: true,
  masterAgreementId: "sample-master",
  currentRevisionId: "000047",
  activeEvents: [
    {
      id: "sample-event",
      effectiveDate: "2026-06-15",
      ordering: "after_scheduled_payment",
      sequence: 1,
      amount: 500,
      treatment: "keep_maturity",
      classification: "ordinary",
      source: "Sample remittance",
      reason: "Illustrative extra payment",
    },
  ],
} satisfies WorkpaperLoanInput;
export const file: FileWorkpaperInput = {
  clientName: "Illustrative client",
  fiscalYearEnd: "2026-12-31",
  masters: [
    {
      id: "sample-master",
      lender: "Illustrative lender",
      securityDescription: "Illustrative equipment charge",
      covenantDescription: "Illustrative borrowing limit",
    },
  ],
  loans: [
    loan,
    {
      ...loan,
      id: "sample-capital",
      isCapitalLease: true,
      fvDecision: null,
      principal: 72000,
      downPayment: 0,
      monthlyPayment: 1400,
      termMonths: 60,
      activeEvents: [],
      covenantViolation: false,
    },
    {
      ...loan,
      id: "sample-operating",
      name: "Illustrative office rental",
      principal: 60000,
      monthlyPayment: 1000,
      termMonths: 60,
      interestRate: 0,
      downPayment: 0,
      masterAgreementId: null,
      activeEvents: [],
      covenantViolation: false,
    },
  ],
};
export const schedule = calculateBookedSchedule(loan).schedule;
export const evidence = {
  ...loan,
  fairValueAccountingEntries: buildFairValueAccountingEntries({
    loan,
    reportingFiscalYearEnd: file.fiscalYearEnd,
  }),
};
export function annualRows() {
  const years = new Map<
    number,
    { label: string; yearEnd: Date; principal: number; interest: number; opening: number; closing: number }
  >();
  for (const r of schedule) {
    const y = r.date.getFullYear(),
      yearEnd = new Date(y, 11, 31);
    const row = years.get(y) ?? {
      label: `Year ending ${format(yearEnd, "MMM d, yyyy")}`,
      yearEnd,
      principal: 0,
      interest: 0,
      opening: r.balance + r.principal,
      closing: 0,
    };
    row.principal += r.principal;
    row.interest += r.interest;
    row.closing = r.balance;
    years.set(y, row);
  }
  return [...years.values()];
}
