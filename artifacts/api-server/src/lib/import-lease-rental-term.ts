/**
 * Verify a cited, complete monthly rental table. A reserve table or a model's
 * numeric term alone is not duration evidence. Ambiguous layouts fail closed.
 */
export function leaseRentalTerm(document: string, supplied?: string | null): { months: number; quote: string } | null {
  const clean = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
  const quote = clean(supplied ?? "");
  if (!quote || quote.length > 600 || !clean(document).toLowerCase().includes(quote.toLowerCase())) return null;
  if (!/\bmonthly\s+(?:rent(?:al)?s?|payments?)\b/i.test(quote) ||
      /\b(?:reserve|depreciation|optional|renewal|extension|example)\b/i.test(quote)) return null;

  // Each populated range must carry a monetary value. A trailing blank range
  // on a standard form is allowed, but must not extend the inferred term.
  const range = /(\d+)(?:st|nd|rd|th)?\s*(?:to|[–—-])\s*(\d+)(?:st|nd|rd|th)?\s+months?\b/gi;
  const matches = [...quote.matchAll(range)];
  if (!matches.length) return null;
  const blocks: Array<{ from: number; to: number; amount: number }> = [];
  let blankFrom = Infinity;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const tail = quote.slice(m.index! + m[0].length, matches[i + 1]?.index);
    const value = tail.match(/^[\s:$=_–—-]*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)\s*$/);
    const from = Number(m[1]), to = Number(m[2]);
    if (from < 1 || to < from) return null;
    if (!value) {
      // Only empty form cells, not prose or unreadable values, are safe blanks.
      if (!/^[\s:$=_–—-]*$/.test(tail)) return null;
      blankFrom = Math.min(blankFrom, from);
      continue;
    }
    blocks.push({ from, to, amount: Number(value[1].replace(/,/g, "")) });
  }
  blocks.sort((a, b) => a.from - b.from);
  let next = 1;
  for (const b of blocks) {
    if (b.from !== next || !Number.isFinite(b.amount) || b.amount <= 0) return null;
    next = b.to + 1;
  }
  if (!blocks.length || blankFrom < next) return null;
  return { months: next - 1, quote };
}
