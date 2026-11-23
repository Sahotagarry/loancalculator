import type { AmortizationRow } from "@workspace/amortization";

/** Accruals and extra-principal events are not contractual rentals. */
export function leaseScheduleCounts(schedule: AmortizationRow[]) {
  return {
    rentals: schedule.filter(row => row.rowType !== "accrued_interest_settlement"
      && row.rowType !== "principal_event" && !row.isGrace && row.payment > 0).length,
    settlementAccruals: schedule.filter(row => row.rowType === "accrued_interest_settlement").length,
  };
}
