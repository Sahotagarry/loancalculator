import { format, isValid, parseISO } from "date-fns";

/** Remove only this file's displayed date from its free-text reference.
 * Preserve distinct references and never change the saved file name. */
export function yearEndFileSubtitle(fiscalYearEnd?: string | null, name?: string | null): string {
  const date = fiscalYearEnd ? parseISO(fiscalYearEnd) : null;
  if (!date || !isValid(date)) return ["Year-End File", name?.trim()].filter(Boolean).join(" · ");
  let reference = name?.trim() ?? "";
  const original = reference;
  for (const pattern of ["MMMM d, yyyy", "MMM d, yyyy", "MMMM d yyyy", "MMM d yyyy", "yyyy-MM-dd"]) {
    const label = format(date, pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    reference = reference.replace(new RegExp(`(?<![\\p{L}\\p{N}])${label}(?![\\p{L}\\p{N}])`, "giu"), "");
  }
  if (reference !== original) {
    reference = reference
      .replace(/^\s*(?:year[- ]end(?: file)?|fye)\b\s*/i, "")
      .replace(/\s*\b(?:year[- ]end(?: file)?|fye)\s*$/i, "")
      .replace(/^[\s·|:—–-]+|[\s·|:—–-]+$/g, "")
      .replace(/\s{2,}/g, " ").trim();
  }
  return ["Year-End File", format(date, "MMMM d, yyyy"), reference].filter(Boolean).join(" · ");
}
