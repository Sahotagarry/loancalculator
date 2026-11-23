import type { ReactNode } from "react";

export function LeaseCalculationAvailability({ unavailable, children }: { unavailable: boolean; children?: ReactNode }) {
  return unavailable
    ? <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">Calculation unavailable — review required. Draft inputs are not reviewed balances. Open Reevaluate Lease to review the financial inputs and ending evidence.</div>
    : <>{children}</>;
}
