/** Only new term loans receive a default. Missing on a stored agreement means periodic. */
export const INTEREST_METHODS = ['actual_365', 'actual_year', 'periodic', 'semi_annual'] as const;
export type InterestMethod = typeof INTEREST_METHODS[number];
export const DEFAULT_LOAN_INTEREST_METHOD: InterestMethod = 'actual_365';
export const interestMethods = {
  actual_365: { label: 'Daily · 365-day year', hint: 'Common for term and vehicle loans. Counts actual days; always divides by 365.' },
  actual_year: { label: 'Daily · 365 or 366', hint: 'Used by some bank instalment loans. Choose when the agreement specifies 366 days in a leap year.' },
  periodic: { label: 'Equal payment periods', hint: 'May suit a simple agreement such as a private or related-party loan if the parties use the annual rate divided by 12 each month. Equal monthly payments alone do not establish this.' },
  semi_annual: { label: 'Mortgage · semi-annual compounding', hint: 'For mortgages quoted as compounded semi-annually, not in advance. Converts the quoted rate to the regular payment period.' },
} satisfies Record<InterestMethod, {label:string; hint:string}>;
export const isDaily = (m?: InterestMethod | null) => m === 'actual_365' || m === 'actual_year';
export const regularRate = (annual: number, periods: number, method?: InterestMethod | null) => method === 'semi_annual'
  ? Math.expm1(2 / periods * Math.log1p(annual / 200)) : annual / 100 / periods;
// Dates are contract calendar dates, not elapsed milliseconds (DST days may be 23/25 hours).
const civil = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
const day = 86400000;
export function accrualYears(from: Date, to: Date, method: InterestMethod) {
  let a = civil(from); const b = civil(to);
  if (!Number.isFinite(a + b) || b < a) throw new Error('Invalid loan interest interval');
  if (method === 'actual_365') return (b-a)/day/365;
  let years = 0;
  while (a < b) {
    const year = new Date(a).getUTCFullYear(); const end = Date.UTC(year+1,0,1);
    const stop = Math.min(end,b);
    years += (stop-a)/(end-Date.UTC(year,0,1)); a = stop;
  }
  return years;
}
