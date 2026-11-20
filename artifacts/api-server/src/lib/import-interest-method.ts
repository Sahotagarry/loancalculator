import type { InterestMethod } from '@workspace/amortization';

// The model must select the applicable clause for this particular facility. An
// instrument label, a lender name or the payment frequency is never evidence.
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[‐‑–—]/g, '-').replace(/\s+/g,' ').trim();
export function verifyInterestClause(method: InterestMethod | null, quote: string | null, document: string) {
  const q = normalize(quote ?? '');
  if (!q || q.length > 700 || !normalize(document).includes(q)) return { interestMethod: null, interestMethodQuote: null };
  const has365 = /\b365\b/.test(q), has366 = /\b366\b/.test(q);
  const leap = /leap year|calendar year|actual\/actual|act\/act/.test(q);
  const fixed365 = has365 && !has366 && /365[ -]+days?|(?:act(?:ual)?\s*\/\s*365)|divid\w*[^.;]{0,35}365|365[ -]+day year/.test(q);
  const supports = {
    actual_365: fixed365,
    actual_year: (has366 && (has365 || leap)) || /\b(?:act\/act|actual\/actual)\b/.test(q),
    semi_annual: /(?:compound|calculat|convert)\w*[^.;]{0,35}semi[ -]?annual|semi[ -]?annual compounding/.test(q),
    periodic: /(?:annual|yearly)[^.;]{0,80}(?:divid\w* by (?:12|twelve|the number of (?:payments|periods))|\/\s*12)|(?:1\s*\/\s*12|one.twelfth)[^.;]{0,60}(?:annual|yearly)/.test(q),
  };
  const matches = Object.entries(supports).filter(([,supported])=>supported);
  return { interestMethod: method && matches.length === 1 && supports[method] && !/\b360\b|overdue|default interest/.test(q) ? method : null, interestMethodQuote: quote };
}
