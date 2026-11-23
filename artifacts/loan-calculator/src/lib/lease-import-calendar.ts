import type { LeaseEndingTerms } from "@workspace/amortization";

export function validLeaseStartDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Confirmation resolves only this machine-generated warning, not other evidence. */
export function changeLeaseCommencement(value: LeaseEndingTerms, date: string, confirmed: boolean): LeaseEndingTerms {
  if (!value.commencement) return value;
  const accepted = confirmed && validLeaseStartDate(date);
  const warning = "Confirm inferred commencement against delivery or commencement evidence.";
  const issues = value.issues.filter(issue => issue !== warning);
  if (value.commencement.basis === "inferred" && !accepted) issues.push(warning);
  return { ...value, status: "draft", issues,
    commencement: { ...value.commencement, date, confirmed: accepted } };
}
