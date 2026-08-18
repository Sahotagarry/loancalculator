/**
 * Copy-on-link security inheritance for facilities under a master agreement.
 *
 * When a loan is linked to a master agreement and neither the request nor the
 * stored loan carries its own security wording, the master's shared security
 * wording is persisted onto the facility as its own security clause. This makes
 * the disclosure survive a later master deletion (which unlinks facilities back
 * to standalone loans). Facility-provided clauses are overrides and always win.
 *
 * Returns the clauses to persist on the facility, or null when nothing should
 * be copied (facility already has wording, or the master has none).
 */
export function resolveInheritedSecurityClauses(
  requestClauses: string[] | null | undefined,
  existingClauses: string[] | null | undefined,
  masterSecurityDescription: string | null | undefined,
): string[] | null {
  const effective = requestClauses !== undefined ? requestClauses : existingClauses;
  if (effective != null && effective.length > 0) return null;
  if (!masterSecurityDescription) return null;
  return [masterSecurityDescription];
}
