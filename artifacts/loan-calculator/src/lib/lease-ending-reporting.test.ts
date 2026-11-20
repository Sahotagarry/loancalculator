import { describe, expect, it } from "vitest";
import { buildLoanSummary, calculateBookedSchedule } from "./aspe-utils";
import { buildLoanWorkpaper } from "./workpaper-export";
import { calculatePVFromAnswers, preTaxMonthlyPayment, type AssessmentAnswers } from "../components/capital-lease-assessment";
import type { LeaseEndingTerms } from "@workspace/amortization";

const ending: LeaseEndingTerms = { version: 1, kind: "guaranteed_residual", amount: 8949.5,
  basis: "stated", source: "Anonymized return/sale shortfall clause", settlementMonth: 48,
  status: "reviewed", issues: [], implicitRate: 7.5306177, discountRate: 7.5306177 };
const loan = { id: "fixture", name: "Synthetic truck", principal: 89949.5, downPayment: 0,
  interestRate: 7.53, amortizationYears: 4, termYears: 4, termMonths: 48, startDate: "2026-03-30",
  paymentTiming: "beginning" as const, paymentFrequency: "monthly", monthlyPayment: 2003.24,
  isCapitalLease: true, leaseEndingTerms: ending };

describe("lease ending lifecycle reporting", () => {
  it("preserves numeric ending amounts in workpaper sections", () => {
    const wp = buildLoanWorkpaper(loan, { clientName: "Synthetic", fiscalYearEnd: "2026-12-31" })!;
    expect(wp.sections.find(s => s.title === "Lease Ending Evidence")?.rows).toContainEqual(["Ending amount", 8949.5]);
  });
  it("retains precision through save/reopen JSON", () => {
    const booked = calculateBookedSchedule(JSON.parse(JSON.stringify(loan)));
    expect(booked.schedule[0].balance).toBeCloseTo(87946.26, 2);
    expect(booked.schedule.at(-1)?.balance).toBeCloseTo(8949.5, 2);
  });
  it("includes residual in future minimum payments and labels guarantee separately", () => {
    const summary = buildLoanSummary(loan, new Date(2026, 2, 29), "2026-12-31")!;
    expect(summary.description).toContain("shortfall guarantee");
    expect("totalMinimumPayments" in summary && summary.totalMinimumPayments).toBeCloseTo(48 * 2003.24 + 8949.5, 2);
  });
  it("blocks draft exports without interpreting them as zero", () => {
    const draft = { ...loan, leaseEndingTerms: { ...ending, status: "draft" as const } };
    expect(buildLoanSummary(draft, new Date(2026, 11, 31), "2026-12-31")).toBeNull();
    expect(() => buildLoanWorkpaper(draft, { clientName: "Synthetic", fiscalYearEnd: "2026-12-31" })).toThrow("review");
  });
  it.each([
    { firstPaymentDate: "2026-04-15" },
    { activeEvents: [{ kind: "principal_prepayment", id: "test", effectiveDate: "2026-05-01", amount: 1000, ordering: "before_scheduled_payment" as const, sequence: 1, treatment: "keep_payment" as const }] },
    { activeRateEvents: [{ kind: "rate_reset" }] },
  ])("fails closed for persisted unsupported reviewed timelines %j", patch => {
    const unsupported = { ...loan, ...patch };
    expect(calculateBookedSchedule(unsupported).evidenceMetadata?.accountingUnavailable).toBe(true);
    expect(buildLoanSummary(unsupported, new Date(2026, 11, 31), "2026-12-31")).toBeNull();
  });
  it("distinguishes recoverable and nonrecoverable tax and excludes services once", () => {
    const a = { monthlyPayment: 1050, paymentIncludesTax: true, taxRate: 5,
      leaseEndingTerms: { ...ending, taxTreatment: "recoverable", servicesMonthly: 100 } } as AssessmentAnswers;
    expect(preTaxMonthlyPayment(a)).toBe(900);
    expect(preTaxMonthlyPayment({ ...a, leaseEndingTerms: { ...a.leaseEndingTerms!, taxTreatment: "nonrecoverable" } })).toBe(950);
    expect(preTaxMonthlyPayment({ ...a, monthlyPayment: 900, leaseEndingTerms: { ...a.leaseEndingTerms!, paymentComponentsApplied: true } })).toBe(900);
  });
  it("uses the selected lower rate for classification PV", () => {
    const a = { ...loan, paymentAtBeginning: true, paymentIncludesTax: false,
      leaseEndingTerms: { ...ending, incrementalBorrowingRate: 6 } } as unknown as AssessmentAnswers;
    expect(calculatePVFromAnswers(a)).toBeGreaterThan(89949.5);
  });
  it.each(["2030-03-30", "2031-12-31"])("keeps the unpaid ending current at %s", date => {
    const summary = buildLoanSummary(loan, new Date(`${date}T00:00:00`), date)!;
    expect("currentPortion" in summary && summary.currentPortion).toBeCloseTo(8949.5, 2);
    expect("longTermPortion" in summary && summary.longTermPortion).toBe(0);
  });
  it("matches assessment PV to normalized distinct first installments", () => {
    const input = { monthlyPayment: 1130, firstPaymentAmount: 2260, termMonths: 12,
      downPayment: 0, interestRate: 0, paymentAtBeginning: false, taxRate: 13,
      leaseEndingTerms: { ...ending, implicitRate: null, discountRate: 0, kind: "none",
        amount: 0, settlementMonth: 12, taxTreatment: "recoverable", taxRate: 13 } } as AssessmentAnswers;
    expect(calculatePVFromAnswers(input)).toBe(13000);
  });
});
