/* ── Loan payload validation shared by create + update routes ────
   Kept free of db/express imports so it can be unit tested. */

/**
 * Validates an fvRate supplied by the client. The fair-value rate is a
 * market discount rate: it must be a finite number strictly greater than
 * zero (a 0% or negative market rate would silently corrupt the FV
 * schedule — the PV loop divides by (1 + rate) powers).
 *
 * Returns an error message when invalid, or null when acceptable.
 * `null`/`undefined` are acceptable here: on create it means "no rate",
 * on update it means "leave unchanged / clear".
 */
export function validateFvRate(fvRate: number | null | undefined): string | null {
  if (fvRate == null) return null;
  if (typeof fvRate !== "number" || !Number.isFinite(fvRate) || fvRate <= 0) {
    return "fvRate must be a finite number greater than 0";
  }
  return null;
}
