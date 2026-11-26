/** Pricing percentages are not financing rates. Keep this source check narrow:
 * reject a matching pricing percentage only when no independent ordinary
 * financing-rate clause supports it. Never infer fair value from a factor. */
export const LEASE_RATE_GUIDANCE = `
Lease financing-rate evidence:
- Index Rate, reference/benchmark rates and Rental Factor percentages are lease-pricing inputs, NOT the lease's annual financing or discount rate. Do not copy them into interestRate, annualize a rental factor, or use them as interest-rate estimates.
- A rental factor normally multiplies a lease-pricing base to determine periodic rent; its implied base is not confirmed fair value.
- A right to reset the rental factor against the index before commencement does not itself establish variable rentals throughout the lease.
- Populate lease interestRate only from an independently stated ordinary annual financing/implicit interest rate; quote its actual clause in fieldNotes.interestRate. If only pricing percentages are stated, return interestRate:null so the application can calculate an implicit rate from supported cash flows and values.
- If the same numerical percentage is independently stated as the ordinary financing rate, retain that rate and cite the financing clause, not the pricing label. Default, overdue and penalty clauses are not ordinary financing-rate evidence.
`;

const pricingLabel = String.raw`(?:index\s+rate|(?:lease\s+)?rental\s+factor|benchmark\s+rate|reference\s+rate)`;
const financingLabel = String.raw`(?:(?:annual|nominal|implicit|financing|contractual)\s+(?:interest\s+)?rate|interest\s+rate)`;
const valueAfterLabel = String.raw`\s*(?:\(\s*(?:%|percent|per\s+annum|annual|p\.?a\.?)\s*\))?\s*[:=\-]?\s*(\d{1,2}(?:\.\d+)?)\s*(%|percent\b)?`;

function labelledRates(text: string, label: string) {
  return [...text.matchAll(new RegExp(String.raw`\b${label}${valueAfterLabel}`, "gi"))]
    // A bare number is only a percentage when the label supplies its unit.
    .filter(match => match[2] || /\(\s*(?:%|percent|per\s+annum|annual|p\.?a\.?)\s*\)/i.test(match[0]))
    .map(match => ({ value: Number(match[1]), index: match.index!, quote: match[0] }));
}

export function verifyLeaseFinancingRate(document: string, rate: number | null) {
  if (rate == null) return { rate, warning: null };
  const text = document.replace(/\u00a0/g, " ");
  const same = (value: number) => Math.abs(value - rate) < 0.0000001;
  const pricing = labelledRates(text, pricingLabel).filter(item => same(item.value));
  if (!pricing.length) return { rate, warning: null };
  const financing = labelledRates(text, financingLabel).some(item => {
    if (!same(item.value)) return false;
    // Do not let a late-payment clause legitimize a matching pricing number.
    const before = text.slice(Math.max(0, item.index - 65), item.index);
    const after = text.slice(item.index + item.quote.length, item.index + item.quote.length + 65);
    return !/\b(?:default|overdue|penalty|late[\s-]+payment)\b/i.test(before.split(/[.;\n]/).at(-1) ?? "") &&
      !/^\s*(?:per\s+annum\s*)?(?:on|for|applies?\s+to)\s+(?:any\s+)?(?:overdue|late|unpaid|default)/i.test(after);
  });
  if (financing) return { rate, warning: null };
  return {
    rate: null,
    warning: `The extracted ${rate}% was excluded from the financing rate because the document identifies it as a pricing index or rental factor, without a separate supporting financing-rate clause. Calculate the implicit rate from the lease values and cash flows.`,
  };
}
