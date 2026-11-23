import type { LeaseEndingTerms } from "@workspace/amortization";
import { documentAgreedCost, documentMonthlyTables } from "./import-monthly-tables";
import { leaseRentalTerm } from "./import-lease-rental-term";

export function leaseSourceFacts(document: string) {
  const rental = leaseRentalTerm(document);
  const tables = documentMonthlyTables(document, "reserve");
  const reserve = tables.length && tables.every(t => JSON.stringify(t.rows) === JSON.stringify(tables[0].rows))
    ? tables[0] : null;
  const cost = documentAgreedCost(document);
  return { rental, reserve, cost };
}

/** Source-verified operands take priority over an omitted or malformed AI field. */
export function recoverLeaseReserveOperands(ending: LeaseEndingTerms, facts: ReturnType<typeof leaseSourceFacts>): LeaseEndingTerms {
  if (!facts.reserve || !facts.cost || !facts.rental || facts.reserve.months !== facts.rental.months ||
      !["unresolved", "guaranteed_residual", "lessor_residual"].includes(ending.kind) ||
      !["reserve", "unsupported"].includes(ending.basis)) return ending;
  const evidence = `${facts.cost.quote}. ${facts.reserve.quote}`;
  return { ...ending, basis: "reserve", baseAmount: facts.cost.amount, reserves: facts.reserve.rows,
    source: ending.source?.trim() ? `${ending.source}\nVerified calculation inputs: ${evidence}` : evidence };
}

export function leaseSourceChecks(facts: ReturnType<typeof leaseSourceFacts>): string {
  if (!facts.rental && !facts.reserve && !facts.cost) return "";
  return `\n\nAPPLICATION-VERIFIED SOURCE CHECKS (computed from populated cells in the original text, not additional contract terms):
${JSON.stringify(facts)}
Use the populated rental period above, not the highest blank printed month range. A blank range beyond the populated term is an unused template row, not a missing year of rent or reserves. Do not reorder a table when quoting it; the original source text remains authoritative. Reserve arithmetic does not itself establish a buyout or guarantee. Return suggestedTreatment only for genuinely unconfirmed obligations, never alongside a clause-supported kind. Keep the agreement date separate from a confirmed delivery date.`;
}
