import type { leaseRateGuidance } from "@/lib/lease-assessment-values";

/** Display only: an AI estimate cannot populate or approve an accounting rate. */
export function LeaseRateFallback({ guidance, estimate }: {
  guidance: ReturnType<typeof leaseRateGuidance>;
  estimate?: number | null;
}) {
  if (!guidance.showEstimate || estimate == null || !Number.isFinite(estimate) || estimate <= 0) return null;
  return <aside aria-label="Unverified AI rate estimate" className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1 text-xs text-amber-950" data-testid="lease-rate-fallback">
    <p className="font-semibold">Implicit rate unavailable — AI estimate for reference only</p>
    <p>{guidance.reason}</p>
    <p>AI market-rate estimate: <strong>{estimate}% annually</strong>. This is not a rate read from this agreement or calculated from this lease.</p>
    <p>Use this only as a starting point for checking lender quotes or comparable borrowing terms. Enter a supported rate yourself and record its source in the review explanation. This suggestion is not applied and is not the client's supported borrowing rate.</p>
  </aside>;
}
