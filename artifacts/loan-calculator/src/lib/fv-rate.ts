/* ── ASPE 3856 fair-value rate resolution & save validation ──────
   Pure logic behind the editable FV rate input on the loan page,
   extracted so it can be unit-tested.

   Precedence: a saved loan.fvRate always wins over the prime + 2%
   suggestion; the suggestion is only a default when nothing has been
   saved. The effective rate applied to the booked schedule is the FV
   rate only when the accountant has decided "use_fv" AND a positive
   rate is available — otherwise the contractual rate stands. */

import { isValidFvRate } from "@workspace/amortization";

export { isValidFvRate };

/** The rate shown in the FV rate input: saved override first, then the
 *  prime + 2% suggestion, then 0 (meaning "unknown — user must enter").
 *  A malformed saved rate (non-numeric, non-finite, non-positive) is
 *  treated as absent so it can never drive the FV math. */
export function resolveSuggestedFvRate(
  savedFvRate: string | number | null | undefined,
  primeSuggestedRate: number | null | undefined,
): number {
  if (savedFvRate != null && savedFvRate !== "") {
    const saved = Number(savedFvRate);
    if (isValidFvRate(saved)) return saved;
  }
  return isValidFvRate(primeSuggestedRate ?? null) ? primeSuggestedRate! : 0;
}

/** The rate the booked schedule actually uses. Falls back to the
 *  contractual rate unless FV treatment was adopted with a valid
 *  (finite, positive) rate. */
export function resolveEffectiveRate(
  fvDecision: string | null | undefined,
  suggestedFvRate: number,
  contractualRate: number,
): number {
  return fvDecision === "use_fv" && isValidFvRate(suggestedFvRate)
    ? suggestedFvRate
    : contractualRate;
}

/** Parse the raw FV rate input text. Returns the positive numeric rate,
 *  or null when the draft is blank, non-numeric, zero, or negative —
 *  anything that must not be saved. */
export function parseFvRateInput(draft: string | null | undefined): number | null {
  if (draft == null || draft.trim() === "") return null;
  const parsed = Number(draft);
  if (!isValidFvRate(parsed)) return null;
  return parsed;
}

/** The rate to freeze alongside an FV treatment decision: a valid typed
 *  draft first, then the current suggested/saved rate — but never a
 *  non-positive rate. Returns null when no valid rate exists (e.g. the
 *  prime suggestion hasn't loaded), in which case no fvRate should be
 *  persisted with the decision. */
export function resolveFvRateForDecision(
  draft: string | null | undefined,
  suggestedFvRate: number,
): number | null {
  const parsed = parseFvRateInput(draft);
  if (parsed != null) return parsed;
  return isValidFvRate(suggestedFvRate) ? suggestedFvRate : null;
}

/** Whether the Save button should be enabled: a valid positive rate that
 *  actually differs from what is already in effect, and no save in flight. */
export function canSaveFvRate(
  draft: string | null | undefined,
  suggestedFvRate: number,
  isPending: boolean,
): boolean {
  if (isPending) return false;
  const parsed = parseFvRateInput(draft);
  return parsed != null && parsed !== suggestedFvRate;
}
