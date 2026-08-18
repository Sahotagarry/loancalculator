import { isOperatingLeaseLoan } from "./aspe-utils";

/* ── ASPE 3856 fair value assessment gating ──────────────────────
   Which items need the low-rate warning + FV decision workflow.

   - Genuine 0% loans (related-party / forgivable) are the strongest
     candidates for a fair value adjustment, so they get the "required"
     (urgent) treatment.
   - Operating leases also carry a 0% rate but are expense-based under
     ASPE 3065 — they are never FV candidates and must be excluded.
   - Capital leases are measured under ASPE 3065, not 3856 — excluded. */

export interface FvAssessmentLoanInput {
  isCapitalLease: boolean;
  interestRate: string | number;
  monthlyPayment?: string | number | null;
  termMonths?: number | null;
}

/** A true 0% loan (not a capital or operating lease). */
export function isZeroRateFvCandidate(loan: FvAssessmentLoanInput): boolean {
  return (
    Number(loan.interestRate) === 0 &&
    !loan.isCapitalLease &&
    !isOperatingLeaseLoan(loan)
  );
}

/** Show the ASPE 3856 warning + FV decision workflow. */
export function needsFvAssessment(loan: FvAssessmentLoanInput): boolean {
  const rate = Number(loan.interestRate);
  return isZeroRateFvCandidate(loan) || (rate > 0 && rate < 3);
}

/** Urgent ("required") variant: 0% loans and rates below 1%. */
export function needsUrgentFvAssessment(loan: FvAssessmentLoanInput): boolean {
  const rate = Number(loan.interestRate);
  return isZeroRateFvCandidate(loan) || (rate > 0 && rate < 1);
}
