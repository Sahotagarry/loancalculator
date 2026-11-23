import type { LeaseEndingTerms } from "@workspace/amortization";

/** New imports only: a useful best assessment must remain separate from facts. */
export function addLeaseEndingSuggestion(ending: LeaseEndingTerms, document: string): LeaseEndingTerms {
  const withoutSuggestion = () => {
    if (!ending.suggestedTreatment) return ending;
    const { suggestedTreatment: _, ...rest } = ending;
    return rest;
  };
  if (ending.kind !== "unresolved") return withoutSuggestion();
  // Do not turn contradictory evidence into an apparently clear recommendation.
  if (ending.issues.some(issue => /conflict|contradict|alternative settlements/i.test(issue))) return withoutSuggestion();
  const suggestedTreatment = ending.suggestedTreatment ?? (ending.basis === "reserve" && ending.amount != null && ending.amount > 0 ? {
    kind: "guaranteed_residual" as const,
    reason: "The agreed cost and monthly depreciation reserves suggest the client covers a loss when the asset is sold. The settlement clause was not confirmed in the supplied pages. This is the best assessment from the available information, not a stated buyout.",
    accepted: false,
  } : undefined);
  const text = document.replace(/\s+/g, " ");
  if (suggestedTreatment?.kind === "guaranteed_residual" &&
      (/\b(?:not|never)\s+(?:be\s+)?(?:liable|responsible)\b.{0,100}\b(?:shortfall|deficiency|residual)\b/i.test(text) ||
      /\b(?:lessor|leasing company|owner)\b.{0,70}\b(?:solely|exclusively)\b.{0,70}\b(?:loss|residual|risk)\b/i.test(text))) return withoutSuggestion();
  return suggestedTreatment ? { ...ending, suggestedTreatment: { ...suggestedTreatment, accepted: false } } : ending;
}
