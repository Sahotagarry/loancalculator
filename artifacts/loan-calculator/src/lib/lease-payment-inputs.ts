import type { LeaseEndingTerms } from "@workspace/amortization";
import type { AssessmentAnswers } from "../components/capital-lease-assessment";

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
