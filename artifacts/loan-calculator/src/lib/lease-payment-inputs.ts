import type { LeaseEndingTerms } from "@workspace/amortization";
import type { AssessmentAnswers } from "../components/capital-lease-assessment";
import { assessmentConclusion } from "./lease-assessment-values";

/** Results only summarize a completed assessment; repair happens in a criterion. */
export function assessmentStepReady(a: AssessmentAnswers, step: number): boolean {
  if (step === 3) return Number.isFinite(a.economicLife) && a.economicLife > 0 &&
    Number.isInteger(a.termMonths) && a.termMonths > 0;
  if (step >= 4 && step <= 6) {
    const result = assessmentConclusion(a);
    return result.status !== "needs_review" && result.minimum != null;
  }
  return true;
}

export function assessmentEntryStep(a: AssessmentAnswers, requested: number): number {
  if (requested < 6) return requested;
  if (!assessmentStepReady(a, 3)) return 3;
  if (!assessmentStepReady(a, 4)) return 4;
  return requested;
}

export type LeaseTaxTreatment = NonNullable<LeaseEndingTerms["taxTreatment"]>;

/** Imported evidence wins over the old UI checkbox. */
export function currentTaxTreatment(a: AssessmentAnswers): LeaseTaxTreatment | "" {
  if (a.leaseEndingTerms) return a.leaseEndingTerms.taxTreatment ?? "";
  return a.paymentIncludesTax ? "recoverable" : "excluded";
}

export function changeCriterionTaxTreatment(a: AssessmentAnswers, treatment: LeaseTaxTreatment): AssessmentAnswers {
  return { ...a, paymentIncludesTax: treatment === "recoverable",
    ...(a.leaseEndingTerms ? { leaseEndingTerms: {
      ...a.leaseEndingTerms, taxTreatment: treatment,
      grossMonthlyPayment: a.leaseEndingTerms.grossMonthlyPayment ?? a.monthlyPayment,
      ...(a.firstPaymentAmount != null ? {
        grossFirstPaymentAmount: a.leaseEndingTerms.grossFirstPaymentAmount ?? a.firstPaymentAmount,
      } : {}),
      paymentComponentsApplied: false, firstPaymentComponentsApplied: false, status: "draft" as const,
    } } : {}),
  };
}

export function changeCriterionTaxRate(a: AssessmentAnswers, rate: number | undefined): AssessmentAnswers {
  return { ...a, taxRate: rate ?? 0,
    ...(a.leaseEndingTerms ? { leaseEndingTerms: {
      ...a.leaseEndingTerms, taxRate: rate,
      paymentComponentsApplied: false, firstPaymentComponentsApplied: false, status: "draft" as const,
    } } : {}),
  };
}
