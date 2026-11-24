import { inferLeaseCommencement, type LeaseEndingTerms } from "@workspace/amortization";

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** An agreement date is a suggestion only, never evidence of actual delivery. */
export function suggestLeaseCommencement(document: string, expiry: string | null, term: number | null): LeaseEndingTerms["commencement"] | null {
  const text = document.normalize("NFKC").replace(/_/g, " ").replace(/\s+/g, " ");
  const dates = new Map<string, string>();
  const pattern = /\b(?:this\s+agreement(?:\s+is)?\s+(?:made|dated)(?:\s+as\s+of)?(?:\s+the)?|agreement\s+date\s*:?)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?([a-z]{3,9})\.?\s*,?\s*(20\s*\d{2})\b/gi;
  for (const match of text.matchAll(pattern)) {
    const month = months.indexOf(match[2].slice(0, 3).toLowerCase());
    const year = match[3].replace(/\s/g, "");
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (month < 0 || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) continue;
    dates.set(date, match[0]);
  }
  if (dates.size === 1) {
    const [date, source] = [...dates][0];
    return { date, basis: "inferred", confirmed: false,
      source: `Agreement date: “${source}”. Used as the proposed start date; not a confirmed delivery date. Confirm or adjust it using the first payment, invoice or other available records.${expiry ? ` The agreement ends ${expiry}; check that the dates and rental period agree.` : ""}` };
  }
  return expiry && term ? inferLeaseCommencement(expiry, term) : null;
}
