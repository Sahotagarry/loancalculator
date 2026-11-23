import type { LeaseEndingTerms } from "@workspace/amortization";

/** Kept beside the final action so later form edits cannot hide draft status. */
export function LeaseSaveStatus({ ending, validationError }: {
  ending?: LeaseEndingTerms | null;
  validationError: string | null;
}) {
  if (!ending) return null;
  const draft = ending.status !== "reviewed";
  return (
    <p role="status" className={`w-full text-sm ${draft ? "text-amber-800" : "text-muted-foreground"}`} data-testid="lease-save-status">
      {draft
        ? "Draft lease — saving keeps accounting calculations and reports unavailable. Review the financial inputs and ending evidence to make it ready."
        : validationError
          ? "Ending evidence reviewed — complete the required fields before saving."
          : "Ready to save — ending evidence reviewed."}
    </p>
  );
}
