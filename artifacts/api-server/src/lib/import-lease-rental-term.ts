/**
 * Verify a cited, complete monthly rental table. A reserve table or a model's
 * numeric term alone is not duration evidence. Ambiguous layouts fail closed.
 */
const clean = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();

function parseRentalTable(quote: string): { months: number; quote: string } | null {
  if (!quote || quote.length > 600) return null;
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

export function leaseRentalTerm(document: string, supplied?: string | null): { months: number; quote: string } | null {
  const text = clean(document);
  const cited = clean(supplied ?? "");
  const candidates = new Set<string>();
  // OCR commonly reads two-column tables across rows. The model may omit the
  // heading or reorder cells in its quote. Verify the actual source section too,
  // without using a reserve schedule or relying on the model's numeric answer.
  for (const heading of text.matchAll(/\bmonthly\s+(?:rent(?:al)?s?|payments?)\s*:/gi)) {
    const before = text.slice(Math.max(0, heading.index! - 90), heading.index);
    if (/\b(?:reserve|depreciation|optional|renewal|extension|example)\b/i.test(before)) continue;
    const section = text.slice(heading.index!, heading.index! + 1400);
    const boundary = section.search(/\s+(?:\d+\.\s+[A-Z]|The\s+(?:Company|Lessee)\b)/);
    candidates.add((boundary < 0 ? section : section.slice(0, boundary)).trim());
  }
  // A partial AI quote must not compete with the complete source table.
  const verified = [...candidates].map(parseRentalTable).filter((v): v is NonNullable<typeof v> => v !== null);
  if (!verified.length && cited && text.toLowerCase().includes(cited.toLowerCase())) {
    const table = parseRentalTable(cited);
    if (table) verified.push(table);
  }
  if (!verified.length || verified.some(v => v.months !== verified[0].months)) return null;
  return verified[0];
}
