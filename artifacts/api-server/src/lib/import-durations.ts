import { leaseRentalTerm } from "./import-lease-rental-term";

/** New imports only. Model numbers are never the source of truth for a duration. */
type Evidence = {
  termQuote?: string | null;
  amortizationQuote?: string | null;
  paymentScheduleQuote?: string | null;
};
type Hit = { months: number; quote: string };
type Kind = "term" | "amortization";

const small = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const tens = "twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
const words = `(?:${tens.join("|")})(?:[ -](?:${small.slice(1, 10).join("|")}))?|${small.slice(1).join("|")}`;
const amount = `(?:\\d+(?:\\.\\d+)?|${words})`;
const number = `(?<amount>${amount})(?:\\s*\\((?<repeat>\\d+(?:\\.\\d+)?)\\))?`;
const unit = "(?<unit>months?|mos\\.?|years?|yrs?\\.?)";
const instrument = "(?:(?:the|this)\\s+)?(?:contract|lease|loan|agreement|financing)";
const term = `(?:(?:(?:lease|loan|contract|initial|original|financing)\\s+)?(?:term|duration)(?:\\s+of\\s+${instrument})?|(?:lease|loan|contract)\\s+period|length\\s+of\\s+${instrument})`;
const amort = "(?:amorti[sz]ation(?:\\s+(?:period|term|schedule))?|amorti[sz](?:ed|es))";
const gap = "[\\s_:–—=\\-]*";
const link = `${gap}(?:(?:shall\\s+be|will\\s+be|is|of|over|for)\\s+)?(?:a\\s+period\\s+of\\s+)?`;
function numberValue(raw: string): number {
  if (/^\d/.test(raw)) return Number(raw);
  const [a, b] = raw.toLowerCase().split(/[ -]/);
  return small.includes(a) ? small.indexOf(a) : (tens.indexOf(a) + 2) * 10 + (b ? small.indexOf(b) : 0);
}
const clean = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();

function hits(text: string, kind: Kind): Hit[] {
  const label = kind === "term" ? term : amort;
  const patterns = [
    `\\b${label}\\b${link}${number}[\\s_–—-]*${unit}\\b`,
    `\\b${label}\\s*\\(\\s*(?:in\\s+)?${unit}\\s*\\)${gap}${number}\\b`,
    `\\b${number}[\\s_–—-]*${unit}\\b\\s+${label}\\b`,
  ];
  const found: Hit[] = [];
  for (const [index, pattern] of patterns.entries()) {
    for (const m of text.matchAll(new RegExp(pattern, "gi"))) {
      const before = text.slice(Math.max(0, m.index! - 45), m.index);
      // Adjacent OCR fields: “Term: 60 months Amortization: 84 months”.
      // The value belongs to the preceding label, not the next heading.
      if (index === 2 && new RegExp(`(?:${term}|${amort})${link}$`, "i").test(before)) continue;
      if (/\b(?:renewal|extension|optional|remaining|minimum|maximum|up to|at least|not exceeding|estimated|example|not|additional|option for)(?:\s+(?:a|an|of|the))?\s*$/i.test(before)) continue;
      if (kind === "term" && /amorti[sz]ation\s*$/i.test(before)) continue;
      const g = m.groups!;
      const n = numberValue(g.amount);
      const months = n * (/^y/i.test(g.unit) ? 12 : 1);
      // Mixed or non-integral month periods can't be represented safely on these forms.
      const after = text.slice(m.index! + m[0].length);
      if ((g.repeat && Number(g.repeat) !== n) || !Number.isSafeInteger(months) || months <= 0 ||
          new RegExp(`^\\s*(?:(?:and|plus|or|to)\\s+)?${amount}\\s+(?:months?|years?|days?|weeks?)\\b`, "i").test(after)) {
        found.push({ months: NaN, quote: m[0] });
      } else found.push({ months, quote: m[0] });
    }
  }
  return found;
}

export function verifyDurations(document: string, evidence: Evidence, kind: "loan" | "lease" | "facility") {
  const text = clean(document);
  const verified = (quote?: string | null) => {
    const q = clean(quote ?? "");
    return q && q.length <= 600 && text.toLowerCase().includes(q.toLowerCase()) ? q : "";
  };
  const scoped = kind === "facility";
  const warnings: string[] = [];
  function resolve(field: Kind, supplied?: string | null): Hit | null {
    const quote = verified(supplied);
    // Never search other facilities' clauses for a missing duration.
    const matches = hits(scoped ? quote : text, field);
    if (field === "term" && kind === "lease") {
      const rental = leaseRentalTerm(document, evidence.paymentScheduleQuote);
      if (rental) matches.push(rental);
    }
    if (!matches.length || matches.some(m => !Number.isFinite(m.months) || m.months !== matches[0].months)) {
      const name = field === "term" ? "Term" : "Amortization";
      warnings.push(matches.length
        ? `${name}: conflicting or unclear durations. Confirm the period in the agreement.`
        : kind === "lease" && field === "term" && /\bmonthly\s+(?:rent(?:al)?s?|payments?)\b/i.test(document)
        ? "Term: a monthly rental table was detected, but its populated ranges or amounts could not be verified. Check the rental rows; blank future template rows do not extend the term."
        : `${name}: no separately supported duration with a clear unit. Enter it after review.`);
      return null;
    }
    return matches[0];
  }
  let t = resolve("term", evidence.termQuote);
  const a = kind === "lease" ? null : resolve("amortization", evidence.amortizationQuote);
  const scheduleText = (scoped ? verified(evidence.paymentScheduleQuote) : text).replace(/_/g, " ");
  const counts = [
    ...scheduleText.matchAll(/\b(\d+)\s+(?:(?:consecutive|equal|regular|blended)\s+)*monthly\s+(?:instal{1,2}ments?|payments?)\b/gi),
    ...scheduleText.matchAll(/\b(?:number|no\.)\s+of\s+monthly\s+(?:payments|instal{1,2}ments)\s*[:=]?\s*(\d+)\b/gi),
  ].map(m => Number(m[1]));
  if (t && counts.length && counts.some(n => n !== t!.months)) {
    warnings.push(`Term: “${t.quote}” does not match the monthly payment count. Check for a deferral or a separate payment phase before entering the term.`);
    t = null;
  }
  return {
    termMonths: t?.months ?? null, termYears: t ? t.months / 12 : null, termQuote: t?.quote ?? null,
    amortizationMonths: a?.months ?? null, amortizationYears: a ? a.months / 12 : null, amortizationQuote: a?.quote ?? null,
    durationWarnings: warnings,
  };
}
