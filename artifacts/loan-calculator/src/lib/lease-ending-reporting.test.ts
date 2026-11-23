import { describe, expect, it } from "vitest";
import { buildLoanSummary, calculateBookedSchedule, isOperatingLeaseLoan } from "./aspe-utils";
import { buildLoanWorkpaper, excelNumbers } from "./workpaper-export";
import { calculatePVFromAnswers, preTaxMonthlyPayment, type AssessmentAnswers } from "../components/capital-lease-assessment";
import type { LeaseEndingTerms } from "@workspace/amortization";
import { assessmentConfirmationKey, assessmentConclusion, savedLeaseConclusion, rentalAssessment, savedRentalAssessment, meetsRequiredEndingTest, normalizedAssessmentAnswers, assessmentPaymentSaveValues, assessmentAnswersForReview } from "./lease-assessment-values";
import { runLoanDiagnostics } from "./diagnostics";
import { calculateStraightLineLease } from "./straight-line";

const ending: LeaseEndingTerms = { version: 1, kind: "guaranteed_residual", amount: 8949.5,
  basis: "stated", source: "Anonymized return/sale shortfall clause", settlementMonth: 48,
  status: "reviewed", issues: [], implicitRate: 7.5306177, discountRate: 7.5306177 };
const loan = { id: "fixture", name: "Synthetic truck", principal: 89949.5, downPayment: 0,
  interestRate: 7.53, amortizationYears: 4, termYears: 4, termMonths: 48, startDate: "2026-03-30",
  paymentTiming: "beginning" as const, paymentFrequency: "monthly", monthlyPayment: 2003.24,
  isCapitalLease: true, leaseEndingTerms: ending };

describe("lease ending lifecycle reporting", () => {
  const classified = { ...loan, fairValue: 95000, transferOfOwnership: false,
    bargainPurchaseOption: false, leaseTermPct: 40, assetUsefulLife: 10, specializedAsset: false };
  const answers = { ...classified, economicLife: 10, paymentAtBeginning: true,
    paymentIncludesTax: false, taxRate: 0 } as unknown as AssessmentAnswers;
  it("agrees on the 87.7% rental and 94.7% guarantee example across entry, reopen, file checks and both workpaper formats", () => {
    const manual = assessmentConclusion(answers);
    const imported = assessmentConclusion(JSON.parse(JSON.stringify(answers)));
    const saved = savedLeaseConclusion(classified);
    expect(manual).toEqual(imported);
    expect(manual).toEqual(saved);
    expect(saved.status).toBe("capital");
    expect(saved.rental?.percent).toBeCloseTo(87.7, 1);
    expect(saved.required?.percent).toBeCloseTo(94.7, 1);
    expect(saved.reasons).toEqual(["Required payments meet the 90% guideline, although rent alone does not"]);
    const findings = runLoanDiagnostics(classified, { id: "synthetic", clientId: "synthetic", fiscalYearEnd: "2026-12-31" }).findings;
    expect(findings.some(f => /lease-classification|cap-no-criteria/.test(f.id))).toBe(false);
    for (const cells of [undefined, excelNumbers]) {
      const wp = buildLoanWorkpaper(classified, { clientName: "Synthetic", fiscalYearEnd: "2026-12-31" }, null, cells)!;
      const section = wp.sections.find(s => s.title.startsWith("Lease Classification"))!;
      expect(section.rows).toContainEqual(["Confirmed supporting reasons", saved.reasons.join("; ")]);
      expect(section.rows.find(r => r[0] === "Required-payment support as % of fair value")?.[1])
        .toEqual(cells ? saved.required!.percent / 100 : "94.68%");
      expect(section.rows.some(r => /opening|obligation/i.test(String(r[0])))).toBe(false);
    }
  });
  it("keeps complete-looking draft guarantees unresolved, never definitively operating", () => {
    const draft = { ...answers, leaseEndingTerms: { ...ending, status: "draft" as const } };
    expect(assessmentConclusion(draft).status).toBe("needs_review");
    expect(assessmentConclusion(draft).required).toBeNull();
    expect(meetsRequiredEndingTest(draft, rentalAssessment(draft))).toBe(false);
  });
  it("requires explicit reconfirmation after evidence edits even if the outcome and displayed percentage do not change", () => {
    const confirmed = assessmentConfirmationKey(answers);
    for (const patch of [
      { source: "New synthetic clause reference" }, { amount: ending.amount! + 0.01 },
      { settlementMonth: 49 }, { status: "draft" as const },
    ]) {
      const edited = { ...answers, leaseEndingTerms: { ...ending, ...patch } };
      expect(assessmentConfirmationKey(edited)).not.toBe(confirmed);
    }
    const edited = { ...answers, leaseEndingTerms: { ...ending, source: "Reconfirmed source" } };
    expect(assessmentConclusion(edited).status).toBe(assessmentConclusion(answers).status);
    expect(assessmentConclusion(edited).rental).toEqual(assessmentConclusion(answers).rental);
    const reconfirmed = assessmentConfirmationKey(edited);
    expect(reconfirmed).toBe(assessmentConfirmationKey(JSON.parse(JSON.stringify(edited))));
    expect(assessmentConfirmationKey(answers)).toBe(confirmed);
  });
  it("requires resolution of bargain-purchase conflicts without mutating the supplied evidence", () => {
    const before = JSON.stringify(answers);
    const conflict = assessmentConclusion({ ...answers, bargainPurchaseOption: true });
    expect(conflict.status).toBe("needs_review");
    expect(conflict.rationale).toContain("shortfall guarantee is not a purchase");
    expect(assessmentConclusion({ ...answers, leaseEndingTerms: { ...ending, kind: "bargain_purchase" } }).status).toBe("needs_review");
    const bargain = assessmentConclusion({ ...answers, bargainPurchaseOption: true,
      leaseEndingTerms: { ...ending, kind: "bargain_purchase" }, fairValue: 200000 });
    expect(bargain.status).toBe("capital");
    expect(bargain.rental?.meets).toBe(false);
    expect(JSON.stringify(answers)).toBe(before);
  });
  it.each(["optional_purchase", "lessor_residual"] as const)("does not use %s to meet required-payment support", kind => {
    const result = assessmentConclusion({ ...answers, leaseEndingTerms: { ...ending, kind } });
    expect(result.status).toBe("operating");
    expect(result.required).toBeNull();
  });
  it("retains historical classification and labels missing evidence unavailable rather than failed", () => {
    const historical = { ...loan, leaseEndingTerms: null };
    expect(savedLeaseConclusion(historical).status).toBe("needs_review");
    const wp = buildLoanWorkpaper(historical, { clientName: "Synthetic", fiscalYearEnd: "2026-12-31" })!;
    const section = wp.sections.find(s => s.title.startsWith("Lease Classification"))!;
    expect(section.rows).toContainEqual(["Saved classification", "Capital lease"]);
    expect(section.rows).toContainEqual(["Rent as % of fair value", "Unavailable — not a failed test"]);
    expect(section.rows).toContainEqual(["Evidence status", "Needs review — historical classification retained"]);
  });
  it("does not round a below-90 required-payment comparison into a pass", () => {
    const pv = savedLeaseConclusion(classified).required!.pv;
    expect(savedLeaseConclusion({ ...classified, fairValue: pv / 0.89999 }).status).toBe("operating");
    expect(savedLeaseConclusion({ ...classified, fairValue: pv / 0.90001 }).status).toBe("capital");
  });
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
  it("uses the selected lower rate for capital measurement before the fair value cap", () => {
    const a = { ...loan, paymentAtBeginning: true, paymentIncludesTax: false,
      leaseEndingTerms: { ...ending, incrementalBorrowingRate: 6 } } as unknown as AssessmentAnswers;
    expect(calculatePVFromAnswers(a)).toBeGreaterThan(89949.5);
  });
  it("separates the truck's rent-only assessment from its subsequent opening measurement", () => {
    const a = { ...loan, leaseEndingTerms: ending, fairValue: 89949.5, paymentAtBeginning: true } as unknown as AssessmentAnswers;
    expect(rentalAssessment(a)?.percent).toBeCloseTo(92.6, 1);
    expect(calculatePVFromAnswers(a)).toBe(89949.5);
    expect(savedRentalAssessment({ ...loan, fairValue: a.fairValue })?.percent).toBeCloseTo(92.6, 1);
    expect(rentalAssessment({ ...a, interestRate: 7.53, leaseEndingTerms: null })?.pv).toBeCloseTo(83322.38, 2);
    const wp = buildLoanWorkpaper({ ...loan, fairValue: a.fairValue }, { clientName: "Example", fiscalYearEnd: "2026-12-31" })!;
    const assessment = wp.sections.find(s => s.title.startsWith("Lease Classification"))!;
    expect(assessment.rows.some(r => r[0] === "Rent as % of fair value")).toBe(true);
    expect(assessment.rows.some(r => String(r[0]).includes("Obligation"))).toBe(false);
    expect(wp.sections.find(s => s.title === "Capital Lease Calculation")?.rows.some(r => String(r[0]).includes("Obligation"))).toBe(true);
  });
  it("does not add terminal amounts to the rental stream or treat ordinary purchase options as required", () => {
    const a = { ...loan, fairValue: 95000, paymentAtBeginning: true } as unknown as AssessmentAnswers;
    const r = rentalAssessment(a)!;
    expect(r.meets).toBe(false);
    expect(meetsRequiredEndingTest(a, r)).toBe(true);
    for (const kind of ["optional_purchase", "lessor_residual", "bargain_purchase", "unresolved"] as const) {
      const variant = { ...a, leaseEndingTerms: { ...ending, kind } };
      expect(rentalAssessment(variant)).toEqual(r);
      expect(meetsRequiredEndingTest(variant, r)).toBe(false);
    }
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

  it("preserves the reviewed 11,800 opening and 1,900 first financing installment", () => {
    const input = { monthlyPayment: 1130, firstPaymentAmount: 2260, termMonths: 12,
      downPayment: 0, interestRate: 0, paymentAtBeginning: false, taxRate: 13,
      fairValue: 20000,
      leaseEndingTerms: { ...ending, implicitRate: null, discountRate: 0, kind: "none",
        amount: 0, settlementMonth: 12, taxTreatment: "recoverable", taxRate: 13, servicesMonthly: 100 } } as AssessmentAnswers;
    const original = JSON.stringify(input);
    expect(calculatePVFromAnswers(input)).toBe(11800);
    const confirmed = normalizedAssessmentAnswers(input);
    expect(confirmed.monthlyPayment).toBe(900);
    expect(confirmed.firstPaymentAmount).toBe(1900);
    expect(confirmed.leaseEndingTerms?.grossFirstPaymentAmount).toBe(2260);
    const saved = JSON.parse(JSON.stringify({ ...loan, ...assessmentPaymentSaveValues(confirmed, true),
      principal: calculatePVFromAnswers(confirmed), termMonths: 12, termYears: 1,
      amortizationYears: 1, paymentTiming: "end", fairValue: 20000 }));
    const schedule = calculateBookedSchedule(saved);
    expect(schedule.schedule[0].payment).toBe(1900);
    expect(schedule.schedule[0].openingBalance).toBe(11800);
    expect(schedule.schedule[1].payment).toBe(900);
    expect(schedule.schedule.at(-1)?.balance).toBeCloseTo(0, 2);
    expect(schedule.totalPayment).toBe(11800);
    const reopened = assessmentAnswersForReview({ ...confirmed,
      monthlyPayment: saved.monthlyPayment, firstPaymentAmount: saved.firstPaymentAmount,
      leaseEndingTerms: saved.leaseEndingTerms });
    expect(reopened.monthlyPayment).toBe(1130);
    expect(reopened.firstPaymentAmount).toBe(2260);
    expect(calculatePVFromAnswers(reopened)).toBe(11800);
    expect(assessmentPaymentSaveValues(reopened, true)).toEqual(assessmentPaymentSaveValues(confirmed, true));
    const workpaper = buildLoanWorkpaper(saved, { clientName: "Synthetic", fiscalYearEnd: "2026-12-31" })!;
    expect(workpaper.sections.flatMap(s => s.rows)).toContainEqual(["Capitalized amount", "$11,800.00"]);
    expect(JSON.stringify(input)).toBe(original);
  });

  it("includes the larger first advance rental in legacy opening PV without adopting ending metadata", () => {
    const input = { ...loan, interestRate: 7.5306177, paymentAtBeginning: true,
      leaseEndingTerms: null, firstPaymentAmount: 5003.24 } as unknown as AssessmentAnswers;
    expect(calculatePVFromAnswers({ ...input, firstPaymentAmount: null })).toBe(83321.43);
    expect(calculatePVFromAnswers(input)).toBe(86321.43);
    expect(normalizedAssessmentAnswers(input).leaseEndingTerms).toBeNull();
  });

  it("does not replace edited financing installments with older gross evidence on re-evaluation", () => {
    const edited = { monthlyPayment: 850, firstPaymentAmount: 1800, termMonths: 12,
      interestRate: 0, downPayment: 0, paymentAtBeginning: false,
      leaseEndingTerms: { ...ending, kind: "none", amount: 0, settlementMonth: 12,
        implicitRate: null, discountRate: 0, status: "draft", taxTreatment: "recoverable",
        taxRate: 13, servicesMonthly: 100, grossMonthlyPayment: 1130, grossFirstPaymentAmount: 2260,
        paymentComponentsApplied: true, firstPaymentComponentsApplied: true } } as AssessmentAnswers;
    const reviewed = assessmentAnswersForReview(edited);
    expect(assessmentPaymentSaveValues(reviewed, true).monthlyPayment).toBe(850);
    expect(assessmentPaymentSaveValues(reviewed, true).firstPaymentAmount).toBe(1800);
    expect(calculatePVFromAnswers(reviewed)).toBe(11150);
  });

  it.each([0, 6])("uses identical legacy and explicit rental streams at %s percent, advance and arrears", interestRate => {
    for (const paymentAtBeginning of [true, false]) {
      const input = { monthlyPayment: 900, firstPaymentAmount: 1900, downPayment: 500,
        termMonths: 12, interestRate, paymentAtBeginning, paymentIncludesTax: false,
        leaseEndingTerms: null } as AssessmentAnswers;
      const explicit = { ...input, leaseEndingTerms: { ...ending, kind: "none" as const,
        amount: 0, settlementMonth: 12, implicitRate: null, discountRate: interestRate } };
      expect(calculatePVFromAnswers(explicit)).toBe(calculatePVFromAnswers(input));
      if (interestRate === 0) expect(calculatePVFromAnswers(input)).toBe(12300);
    }
  });

  it.each([false, true])("keeps nonzero operating assessment rates separate after no-edit confirmation (explicit=%s)", explicit => {
    const original = { ...loan, isCapitalLease: false, interestRate: 0, leaseAssessmentRate: 6,
      principal: 38000, fairValue: 2000000, monthlyPayment: 1000, paymentOverride: 1000,
      termMonths: 36, termYears: 3, amortizationYears: 3, paymentTiming: "end" as const,
      freeRentMonths: 2, rentEscalationRate: 0,
      rentSteps: [{ fromYear: 1, toYear: 1, monthlyRent: 1000 }, { fromYear: 2, toYear: 3, monthlyRent: 1100 }],
      tenantImprovementAllowance: 3000, otherInducements: 500,
      leaseEndingTerms: explicit ? { ...ending, kind: "none" as const, amount: 0,
        settlementMonth: 36, implicitRate: null, discountRate: 6 } : null };
    const assessment = { ...original, interestRate: original.leaseAssessmentRate,
      paymentAtBeginning: false, paymentIncludesTax: false, downPayment: 0 } as unknown as AssessmentAnswers;
    const reopened = JSON.parse(JSON.stringify({ ...original, ...assessmentPaymentSaveValues(assessment, false) }));
    expect(isOperatingLeaseLoan(reopened)).toBe(true);
    expect(reopened.interestRate).toBe(0);
    expect(reopened.leaseAssessmentRate).toBe(6);
    const sl = (l: typeof original) => calculateStraightLineLease({ ...l, baseMonthlyRent: Number(l.monthlyPayment),
      escalationRate: Number(l.rentEscalationRate), fiscalYearEnd: "2026-12-31" });
    expect(sl(reopened)).toEqual(sl(original));
    expect(buildLoanSummary(reopened, new Date(2026, 11, 31), "2026-12-31"))
      .toEqual(buildLoanSummary(original, new Date(2026, 11, 31), "2026-12-31"));
    expect(savedRentalAssessment(reopened)).toEqual(savedRentalAssessment(original));
  });
});
