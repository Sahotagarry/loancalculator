import { updateLeaseSettlementForTerm } from "@workspace/amortization";
import type { LoanFormState } from "../components/loan-form-fields";
import type { AssessmentAnswers } from "../components/capital-lease-assessment";
import { reconcileCalculatedLeaseRate } from "./lease-assessment-values";

/** Add Loan stays a loan; only a confirmed capital assessment opens lease creation. */
export function leaseCreationMode(isCapitalLease: boolean, capitalAssessment: boolean): "loan" | "capital_lease" {
  return isCapitalLease && capitalAssessment ? "capital_lease" : "loan";
}

const financialFields: Array<keyof LoanFormState> = ["principal", "downPayment", "interestRate", "leaseAssessmentRate",
  "amortizationYears", "termYears", "termMonths", "startDate", "paymentFrequency", "paymentTiming", "firstPaymentDate",
  "firstPaymentAmount", "monthlyPayment", "paymentOverride", "balloonPayment", "fairValue", "ioMonths", "graceMonths",
  "transferOfOwnership", "bargainPurchaseOption", "leaseTermPct", "assetUsefulLife", "specializedAsset", "isCapitalLease"];

function rateInputs(f: LoanFormState): AssessmentAnswers {
  return { fairValue: f.fairValue, monthlyPayment: Number(f.paymentOverride ?? f.monthlyPayment ?? 0),
    firstPaymentAmount: f.firstPaymentAmount, termMonths: f.termMonths ?? Math.round(f.termYears * 12),
    downPayment: f.downPayment, interestRate: Number(f.leaseAssessmentRate ?? f.interestRate),
    paymentAtBeginning: f.paymentTiming === "beginning", paymentIncludesTax: false, taxType: "none",
    taxRate: f.leaseEndingTerms?.taxRate ?? 0, buyoutForImplicitRate: 0, leaseEndingTerms: f.leaseEndingTerms,
    transferOfOwnership: f.transferOfOwnership, bargainPurchaseOption: f.bargainPurchaseOption,
    specializedAsset: f.specializedAsset, economicLife: f.assetUsefulLife, assetType: f.assetDescription,
    leaseTermPct: f.leaseTermPct, pvPctFairValue: f.pvPctFairValue,
    rentSteps: f.rentSteps, freeRentMonths: f.freeRentMonths, rentEscalationRate: f.rentEscalationRate,
  };
}

/** Keep editable financial controls and their authoritative accounting metadata in agreement. */
export function resolveLeaseFormChange(previous: LoanFormState, value: LoanFormState): LoanFormState {
  if (!value.leaseEndingTerms) return value;
  let next = value;
  if (value.leaseEndingTerms === previous.leaseEndingTerms && financialFields.some(key => value[key] !== previous[key])) {
    const oldMonths = previous.termMonths ?? Math.round(previous.termYears * 12);
    const months = value.termMonths ?? Math.round(value.termYears * 12);
    next = { ...value, leaseEndingTerms: oldMonths !== months
      ? updateLeaseSettlementForTerm(value.leaseEndingTerms, oldMonths, months)
      : { ...value.leaseEndingTerms, status: "draft" } };
  }
  if (value.interestRate !== previous.interestRate) {
    const rate = value.interestRate === "" ? null : value.interestRate;
    return { ...next, leaseAssessmentRate: rate ?? undefined, leaseEndingTerms: {
      ...next.leaseEndingTerms!, discountRate: rate, implicitRate: null, implicitRateBasis: undefined,
      incrementalBorrowingRate: null, status: "draft",
    } };
  }
  const reconciled = reconcileCalculatedLeaseRate(rateInputs(previous), rateInputs(next));
  if (reconciled.leaseEndingTerms !== next.leaseEndingTerms) return { ...next,
    interestRate: next.isCapitalLease ? reconciled.interestRate : next.interestRate,
    leaseAssessmentRate: reconciled.interestRate, leaseEndingTerms: reconciled.leaseEndingTerms,
  };
  return next;
}
