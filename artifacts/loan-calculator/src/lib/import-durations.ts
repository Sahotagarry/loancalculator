import type { ImportedLoanFields } from "@workspace/api-client-react";

export function durationLabel(months?: number | null, quote?: string | null): string | null {
  return months == null ? null : `${months} months${quote ? ` · “${quote}”` : ""}`;
}

export const validImportMonths = (v?: number | null): v is number =>
  v != null && Number.isSafeInteger(v) && v > 0;

/** Only the editor's backing model uses years. A missing duration stays blank. */
export function importedLoanDurations(f?: ImportedLoanFields | null) {
  return {
    importedDurationMonths: true,
    termYears: validImportMonths(f?.termMonths) ? f.termMonths / 12 : 0,
    amortizationYears: validImportMonths(f?.amortizationMonths) ? f.amortizationMonths / 12 : 0,
  };
}
