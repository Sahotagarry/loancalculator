import type { assessLeaseClassification } from "@workspace/amortization";
import { formatCurrency } from "@/lib/format";
import { percentLabel, leaseReviewIssueLabel } from "@/lib/lease-assessment-values";

/** Classification only: opening recognition belongs to the later measurement stage. */
export function LeasePaymentTest({ conclusion }: { conclusion: ReturnType<typeof assessLeaseClassification> }) {
  const minimum = conclusion.minimum ?? conclusion.draftComparison?.minimum;
  const payments = conclusion.payments ?? conclusion.draftComparison?.payments;
  const draft = !conclusion.minimum;
  const reviewIssues = conclusion.issues.filter(issue =>
    !issue.startsWith("Minimum lease payment comparison unavailable:") &&
    !issue.startsWith("Useful-life comparison unavailable:"),
  ).map(leaseReviewIssueLabel);
  if (!minimum || !payments) return <div className="rounded-lg border p-3 text-sm space-y-2" data-testid="lease-minimum-payment-missing">
    <p className="font-semibold">Minimum lease payments — inputs needed for the 90% test</p>
    <ul className="list-disc pl-5 space-y-1">{[...new Set([...conclusion.comparisonInputsMissing, ...reviewIssues])].map(issue => <li key={issue}>{issue}</li>)}</ul>
  </div>;
  return <div className="space-y-2 rounded-lg border p-3 text-sm" data-testid="lease-minimum-payment-test">
    <p className="font-semibold">Minimum lease payments — 90% test{draft ? " (draft)" : ""}</p>
    {draft && <p className="text-amber-800">Calculated from the current inputs, not yet approved. Confirm the items below before using this result to conclude classification.</p>}
    <dl className="space-y-1">
      <div className="flex justify-between gap-3"><dt>Rentals during the lease term, including any separate upfront payment</dt><dd>{formatCurrency(payments.rentals)}</dd></div>
      <div className="flex justify-between gap-3"><dt>Plus: qualifying end-of-term amount</dt><dd>{formatCurrency(payments.ending)}</dd></div>
      <div className="flex justify-between gap-3 font-semibold"><dt>Total minimum lease payments (before discounting)</dt><dd>{formatCurrency(payments.rentals + payments.ending)}</dd></div>
      <div className="flex justify-between gap-3"><dt>Present value of minimum lease payments</dt><dd>{formatCurrency(minimum.pv)}</dd></div>
    </dl>
    <p><strong>{percentLabel(minimum.percent)}% of fair value</strong> — {draft ? (minimum.meets ? "would meet" : "would not meet") : minimum.meets ? "meets" : "does not meet"} the 90% guideline{draft ? " if these inputs are confirmed" : ""}.</p>
    {draft && <ul className="list-disc pl-5 space-y-1 text-xs text-amber-800">{reviewIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    <p className="text-xs text-muted-foreground">Include qualifying required final payments, non-renewal penalties, or the full guaranteed residual—not just an estimated shortfall. If there is a bargain purchase option, include its price with rentals instead of other ending amounts. A non-bargain optional purchase and an unguaranteed residual are excluded. Recoverable taxes and service costs are excluded.</p>
    {Math.abs(minimum.percent - 100) < 0.05 && <p className="text-xs text-muted-foreground">A result near 100% is not necessarily an error. When the implicit rate is calculated from fair value and these same cash flows, 100% follows from that calculation; it is not independent evidence of fair value.</p>}
  </div>;
}
