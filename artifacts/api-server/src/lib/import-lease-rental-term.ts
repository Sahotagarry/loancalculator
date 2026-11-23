import { documentMonthlyTables, parseMonthlyTable } from "./import-monthly-tables";

/** Verify complete source tables before considering a model's citation. */
export function leaseRentalTerm(document: string, supplied?: string | null): { months: number; quote: string } | null {
  const tables = documentMonthlyTables(document, "rental");
  if (!tables.length && supplied) {
    const clean = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
    if (clean(document).includes(clean(supplied)) &&
        /\bmonthly\s+(?:rent(?:al)?s?|payments?)\b/i.test(supplied) &&
        !/\b(?:reserve|depreciation|optional|renewal|extension|example)\b/i.test(supplied)) {
      const parsed = parseMonthlyTable(supplied);
      if (parsed && parsed.quote.length <= 600) tables.push(parsed);
    }
  }
  if (!tables.length || tables.some(t => t.months !== tables[0].months)) return null;
  return { months: tables[0].months, quote: tables[0].quote };
}
