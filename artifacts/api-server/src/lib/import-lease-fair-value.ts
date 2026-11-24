/** Recover a documentary asset cost as a proposed fair value, not a market valuation.
 * Do not use financed totals, reserve balances, or an AI-supplied formula base. */
export function proposedLeaseFairValue(document: string): { amount: number; note: string } | null {
  const text = document.normalize("NFKC").replace(/_/g, " ");
  const asset = "(?:vehicle|asset|equipment)";
  const label = `(?:agreed\\s+(?:cash\\s+)?cost\\s+of\\s+(?:the\\s+)?${asset}|${asset}\\s+cash\\s+(?:purchase\\s+)?price|cash\\s+(?:purchase\\s+)?price(?:\\s+of\\s+(?:the\\s+)?${asset})?|${asset}\\s+purchase\\s+price)`;
  const pattern = new RegExp(`\\b${label}\\s*[:=\\-]?\\s*\\$?\\s*((?:\\d{1,3}(?:,\\s*\\d{3})+|\\d+)(?:\\s*\\.\\s*\\d{2})?)(?![\\d,]|\\.\\d)\\b`, "gi");
  const matches = [...text.matchAll(pattern)];
  const costs: Array<{ amount: number; quote: string }> = [];
  for (const match of matches) {
    const amount = Number(match[1].replace(/[,\s]/g, ""));
    const before = text.slice(Math.max(0, match.index! - 65), match.index!);
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 110);
    // Never truncate an unsupported spaced-thousands amount (139 994.00) to 139.
    if (!match[1].includes(".") && /^\s+\d{3}(?:\b|[,.])/.test(after)) return null;
    // A tax-inclusive or bundled figure is not a clean asset cash-cost proposal.
    if (/\b(?:total\s+financed|amount\s+financed|financed\s+total)\s*[:=(\-]?\s*$/i.test(before) ||
        /^\s*(?:\(\s*)?(?:(?:including|inclusive\s+of|includes?|incl\.?)\s+.{0,45}\b(?:tax(?:es)?|gst|pst|hst|qst|vat|fees?|services?|insurance|interest|charges?)\b|(?:tax(?:es)?|gst|pst|hst|qst|vat)\s+incl)/i.test(after)) return null;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    costs.push({ amount, quote: match[0].replace(/\s+/g, " ").trim() });
  }
  if (!costs.length || costs.some(cost => cost.amount !== costs[0].amount)) return null;
  return {
    amount: costs[0].amount,
    note: `Proposed fair value based on stated asset cost: “${costs[0].quote}”. Confirm this is the asset's cash price, excluding recoverable taxes, services and financing charges.`,
  };
}
