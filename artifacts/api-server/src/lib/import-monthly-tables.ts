/** Read populated cells, not a form's last printed range. Source quotes stay contiguous. */
export type MonthlyBlock = { fromMonth: number; toMonth: number; monthlyAmount: number };
export type MonthlyTable = { rows: MonthlyBlock[]; months: number; quote: string; blankRanges: number[] };
const normalized = (s: string) => s.normalize("NFKC").replace(/\r/g, "");
const money = /^(?:\d{1,3}(?:,\s*\d{3})+|\d+)(?:\s*\.\s*\d{2})?(?=[\s_$;|]|$)/;
const rangePattern = /(\d+)\s*(?:st|nd|rd|th)?\s*(?:to|[–—-])\s*(\d+)\s*(?:st|nd|rd|th)?\s+months?\b/gi;
const separators = /^[\s:$=_;|–—-]*/;

export function parseMonthlyTable(section: string, allowZero = false): MonthlyTable | null {
  const text = normalized(section);
  const matches = [...text.matchAll(rangePattern)];
  if (!matches.length || text.slice(0, matches[0].index).length > 600) return null;
  const rows: MonthlyBlock[] = [], blankRanges: number[] = [];
  let quoteEnd = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index! + m[0].length;
    const tail = text.slice(start, matches[i + 1]?.index);
    const prefix = tail.match(separators)![0];
    const cell = tail.slice(prefix.length);
    const value = cell.match(money);
    const fromMonth = Number(m[1]), toMonth = Number(m[2]);
    if (fromMonth < 1 || toMonth < fromMonth) return null;
    if (!value) {
      // A dollar sign/blank rule followed by another range is a blank template
      // cell, not a missing year of payments. Unreadable words are not blanks.
      if (cell.trim() && !/^(?:The\s+(?:Company|Lessee)\b|\d+\.\s+[A-Z])/i.test(cell)) return null;
      if (!/[$_]/.test(prefix)) return null;
      blankRanges.push(fromMonth);
      quoteEnd = start + prefix.length;
      continue;
    }
    const monthlyAmount = Number(value[0].replace(/[,\s]/g, ""));
    if (!Number.isFinite(monthlyAmount) || monthlyAmount < 0 || (!allowZero && monthlyAmount === 0)) return null;
    const remainder = cell.slice(value[0].length).replace(/^[\s_;|–—-]+/, "");
    // Never reinterpret two competing values or a malformed decimal as one cell.
    if (/^[\d$.,]/.test(remainder)) return null;
    if (remainder.trim() && i !== matches.length - 1) return null;
    rows.push({ fromMonth, toMonth, monthlyAmount });
    quoteEnd = start + prefix.length + value[0].length;
  }
  rows.sort((a, b) => a.fromMonth - b.fromMonth);
  let next = 1;
  for (const row of rows) {
    if (row.fromMonth !== next) return null;
    next = row.toMonth + 1;
  }
  if (!rows.length || blankRanges.some(from => from < next)) return null;
  return { rows, months: next - 1, quote: text.slice(0, quoteEnd).replace(/\s+/g, " ").trim(), blankRanges };
}

export function documentMonthlyTables(document: string, kind: "rental" | "reserve"): MonthlyTable[] {
  const text = normalized(document);
  const heading = kind === "rental"
    ? /\bmonthly\s+(?:rent(?:al)?s?|payments?)\b\s*[:"]?/gi
    : /\b(?:monthly\s+depreciation\s+reserves?|monthly\s+depreciation\s+allowance|monthly\s+capital\s+reduction)\b\s*[:"]?/gi;
  const tables: MonthlyTable[] = [];
  for (const h of text.matchAll(heading)) {
    const before = text.slice(Math.max(0, h.index! - 90), h.index);
    if (/\b(?:optional|renewal|extension|example)\b/i.test(before)) continue;
    const start = h.index!;
    let section = text.slice(start, start + 4000);
    const repeatedHeading = section.slice(h[0].length).search(new RegExp(heading.source, heading.flags));
    if (repeatedHeading >= 0) section = section.slice(0, h[0].length + repeatedHeading);
    const nextSection = section.search(/\s+\d+\.\s+[A-Z][A-Z /-]*:/);
    if (nextSection >= 0) section = section.slice(0, nextSection);
    // Do not scan across a different financial table when a heading has no cells.
    const other = section.slice(h[0].length).search(kind === "rental"
      ? /\bmonthly\s+depreciation\b/i : /\bmonthly\s+rent(?:al)?s?\b/i);
    if (other >= 0) section = section.slice(0, h[0].length + other);
    const table = parseMonthlyTable(section, kind === "reserve");
    if (table && table.quote.length <= 600) tables.push(table);
  }
  return tables;
}

export function documentAgreedCost(document: string): { amount: number; quote: string } | null {
  const pattern = /\b(?:agreed\s+cost(?:\s+of\s+(?:the\s+)?(?:vehicle|asset|equipment))?|capitalized\s+cost)\s*[:=_-]?\s*\$?\s*((?:\d{1,3}(?:,\s*\d{3})+|\d+)(?:\s*\.\s*\d{2})?)\b/gi;
  const found = [...normalized(document).matchAll(pattern)].map(m => ({
    amount: Number(m[1].replace(/[,\s]/g, "")), quote: m[0].replace(/\s+/g, " ").trim(),
  })).filter(v => Number.isFinite(v.amount) && v.amount > 0);
  return found.length && found.every(v => v.amount === found[0].amount) ? found[0] : null;
}
